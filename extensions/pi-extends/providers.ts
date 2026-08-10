import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import {
	isValidEnvVarName,
	isValidModelId,
	isValidPositiveInt,
	isValidProviderId,
	type CustomModelConfig,
	type CustomModelCostConfig,
	type CustomProviderConfig,
	type PiExtendsConfig,
} from "./config.ts";
import { editConfig } from "./config-ui.ts";
import { getAPI } from "./runtime.ts";
import { getConfig } from "./store.ts";
import { kv, runInfoPage, sep } from "./ui-kit.ts";

const UNKNOWN_MODEL_COST: CustomModelCostConfig = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
};

function providerCacheCompat(cfg: CustomProviderConfig): Model<any>["compat"] | undefined {
	const cache = cfg.cache;
	if (!cache) return undefined;
	const compat: Record<string, boolean | string> = {};
	if (cfg.api === "openai-completions" && cache.anthropicCacheControl) {
		compat.cacheControlFormat = "anthropic";
	}
	if (cache.supportsLongRetention !== undefined) {
		compat.supportsLongCacheRetention = cache.supportsLongRetention;
	}
	return Object.keys(compat).length > 0 ? compat as Model<any>["compat"] : undefined;
}

export interface ProviderStatusLine {
	id: string;
	displayName: string;
	authenticated: boolean;
	custom: boolean;
	modelCount: number;
}

export function collectProviderStatus(
	ctx: ExtensionContext,
	config: PiExtendsConfig,
): ProviderStatusLine[] {
	const customIds = new Set(config.providers.map((p) => p.id));
	const lines: ProviderStatusLine[] = [];
	for (const providerId of ctx.modelRegistry.getRegisteredProviderIds()) {
		const auth = ctx.modelRegistry.getProviderAuthStatus(providerId);
		lines.push({
			id: providerId,
			displayName: ctx.modelRegistry.getProviderDisplayName(providerId),
			authenticated: auth ? auth.configured : false,
			custom: customIds.has(providerId),
			modelCount: ctx.modelRegistry
				.getAll()
				.filter((m) => m.provider === providerId).length,
		});
	}
	return lines;
}

export async function providerStatusPage(ctx: ExtensionContext): Promise<void> {
	const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
	const rows = collectProviderStatus(ctx, config);
	if (rows.length === 0) {
		ctx.ui.notify("没有已注册的厂商。请先登录或添加自定义厂商。", "info");
		return;
	}
	if (ctx.mode !== "tui") {
		const labels = rows.map(
			(l) =>
				`${l.id}${l.custom ? " (自定义)" : ""} · ${l.authenticated ? "已认证" : "未认证"} · ${l.modelCount} 模型`,
		);
		await ctx.ui.select("厂商认证状态（Esc 返回）", labels, { timeout: 60000 });
		return;
	}
	const theme = ctx.ui.theme;
	const authed = rows.filter((r) => r.authenticated).length;
	const lines = rows.map((r) =>
		kv(
			theme,
			r.authenticated ? "◉" : "○",
			r.id,
			[
				theme.fg(r.authenticated ? "success" : "muted", r.authenticated ? "已认证" : "未认证"),
				theme.fg("text", `${r.modelCount} 个模型`),
				theme.fg("dim", r.custom ? "自定义" : r.displayName),
			].join(sep(theme)),
		),
	);
	await runInfoPage(ctx, {
		title: "厂商认证状态",
		titleRight: `${authed}/${rows.length} 已认证`,
		lines,
	});
}

export function providerRegistrationConfig(cfg: CustomProviderConfig) {
	return {
		name: cfg.name,
		baseUrl: cfg.baseUrl,
		apiKey: `$${cfg.apiKeyEnv}`,
		api: cfg.api,
		models: cfg.models.map((m) => {
			const compat = providerCacheCompat(cfg);
			return {
				id: m.id,
				name: m.name ?? m.id,
				reasoning: m.reasoning ?? false,
				input: m.input && m.input.length > 0 ? m.input : (["text"] as ("text" | "image")[]),
				// Pi 要求价格是数字；0 仅是注册占位，footer 会根据原配置显示“未知”。
				cost: m.cost ?? UNKNOWN_MODEL_COST,
				contextWindow: m.contextWindow ?? 128000,
				maxTokens: m.maxTokens ?? 4096,
				...(compat ? { compat } : {}),
			};
		}),
	};
}

function registerProviderWithPi(
	ctx: ExtensionContext,
	cfg: CustomProviderConfig,
): string | undefined {
	try {
		getAPI().registerProvider(cfg.id, providerRegistrationConfig(cfg));
		return undefined;
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
}

export async function addProviderWizard(
	ctx: ExtensionContext,
): Promise<void> {
	const cfg = await collectProvider(ctx);
	if (!cfg) {
		return;
	}
	const current = getConfig(ctx.cwd, ctx.isProjectTrusted());
	const previous = current.providers.find((provider) => provider.id === cfg.id);
	const registered = ctx.modelRegistry.getRegisteredProviderIds().includes(cfg.id);
	if (previous) {
		const replace = await ctx.ui.confirm(
			"替换已有自定义厂商？",
			`Provider ID "${cfg.id}" 已存在，保存后会替换其模型与连接配置。`,
		);
		if (!replace) {
			ctx.ui.notify("已取消，未替换现有厂商。", "info");
			return;
		}
	} else if (registered) {
		const override = await ctx.ui.confirm(
			"覆盖内置厂商？",
			`Provider ID "${cfg.id}" 已由 Pi 注册。继续会覆盖其模型列表，移除自定义配置后才恢复。`,
		);
		if (!override) {
			ctx.ui.notify("已取消，未覆盖内置厂商。", "info");
			return;
		}
	}

	const confirmed = await ctx.ui.confirm(
		"确认厂商",
		`Base URL: ${cfg.baseUrl}\nAPI Key 环境变量: ${cfg.apiKeyEnv}\n模型数: ${cfg.models.length}`,
	);
	if (!confirmed) {
		ctx.ui.notify("已取消，未保存。", "info");
		return;
	}

	await installAndSaveProvider(ctx, cfg, previous);
}

async function collectProvider(
	ctx: ExtensionContext,
	initial?: CustomProviderConfig,
): Promise<CustomProviderConfig | undefined> {
	const idInput = initial ? initial.id : await ctx.ui.input("Provider ID", "如 my-proxy");
	if (idInput === undefined || idInput.trim() === "") return undefined;
	const id = idInput.trim();
	if (!isValidProviderId(id)) {
		ctx.ui.notify(`无效 Provider ID "${id}"。`, "error");
		return undefined;
	}
	const nameInput = await ctx.ui.input("显示名称", initial?.name ?? id);
	if (initial && nameInput === undefined) return undefined;
	const name = nameInput?.trim() || initial?.name || id;

	const baseUrlInput = await ctx.ui.input("Base URL", initial?.baseUrl ?? "https://api.example.com/v1");
	if (baseUrlInput === undefined) {
		return undefined;
	}
	const baseUrl = baseUrlInput.trim() || initial?.baseUrl || "";
	try {
		const url = new URL(baseUrl);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			throw new Error("protocol");
		}
	} catch {
		ctx.ui.notify(`无效 Base URL "${baseUrl}"。`, "error");
		return undefined;
	}

	const apiChoices = ["openai-completions", "openai-responses", "anthropic-messages"];
	if (initial) {
		apiChoices.splice(apiChoices.indexOf(initial.api), 1);
		apiChoices.unshift(initial.api);
	}
	const api = await ctx.ui.select("API 协议", apiChoices);
	if (
		api !== "openai-completions" &&
		api !== "openai-responses" &&
		api !== "anthropic-messages"
	) {
		return undefined;
	}

	const envInput = await ctx.ui.input("API Key 环境变量名", initial?.apiKeyEnv ?? "MY_LLM_API_KEY");
	if (envInput === undefined) {
		return undefined;
	}
	const apiKeyEnv = envInput.trim() || initial?.apiKeyEnv || "";
	if (!isValidEnvVarName(apiKeyEnv)) {
		ctx.ui.notify(`无效环境变量名 "${apiKeyEnv}"。`, "error");
		return undefined;
	}

	const metricsChoices = ["auto", "reported", "unreported"];
	if (initial?.cache?.metrics) {
		metricsChoices.splice(metricsChoices.indexOf(initial.cache.metrics), 1);
		metricsChoices.unshift(initial.cache.metrics);
	}
	const metricsSelection = await ctx.ui.select("缓存指标语义", metricsChoices);
	const metrics =
		metricsSelection === "reported" || metricsSelection === "unreported" || metricsSelection === "auto"
			? metricsSelection
			: initial?.cache?.metrics ?? "auto";
	const anthropicCacheControl =
		api === "openai-completions"
			? await ctx.ui.confirm(
					"发送 Anthropic 风格 cache_control？",
					"仅适用于明确支持该格式的 OpenAI 兼容中转",
				)
			: undefined;
	const supportsLongRetention = await ctx.ui.confirm(
		"支持长缓存保留？",
		"只声明能力；设置 PI_CACHE_RETENTION=long 后 Pi 才会请求长保留",
	);
	const cache = { metrics, anthropicCacheControl, supportsLongRetention };

	const keepModels = initial
		? await ctx.ui.confirm("保留已有模型？", `当前 ${initial.models.length} 个；选择否将重新录入。`)
		: false;
	const models: CustomModelConfig[] = keepModels ? structuredClone(initial?.models ?? []) : [];
	while (true) {
		const addMore =
			models.length === 0
				? true
				: await ctx.ui.confirm("继续添加模型？", `当前已有 ${models.length} 个模型。`);
		if (!addMore) {
			break;
		}
		const model = await collectModel(ctx);
		if (model) {
			models.push(model);
		}
	}
	if (models.length === 0) {
		ctx.ui.notify("未添加任何模型，已取消。", "info");
		return undefined;
	}

	return { id, name, baseUrl, api, apiKeyEnv, cache, models };
}

async function collectModel(
	ctx: ExtensionContext,
): Promise<CustomModelConfig | undefined> {
	const id = (await ctx.ui.input("模型 ID", "例如 deepseek-v3"))?.trim();
	if (id === undefined || id === "") {
		return undefined;
	}
	if (!isValidModelId(id)) {
		ctx.ui.notify(`无效模型 ID "${id}"。`, "error");
		return undefined;
	}
	const name = (await ctx.ui.input("模型显示名称", id))?.trim() || id;
	const reasoning = await ctx.ui.confirm("支持 reasoning/思考？", "");
	const supportsImage = await ctx.ui.confirm("支持图片输入？", "开启后可被 vision 路由识别");
	const input: ("text" | "image")[] = supportsImage ? ["text", "image"] : ["text"];

	const ctxRaw = await ctx.ui.input("context window（token，回车跳过）", "");
	let contextWindow: number | undefined;
	if (ctxRaw && ctxRaw.trim() !== "") {
		const n = Number(ctxRaw.trim());
		if (isValidPositiveInt(n)) {
			contextWindow = n;
		} else {
			ctx.ui.notify(`无效 context window "${ctxRaw}"，使用默认。`, "warning");
		}
	}

	const maxRaw = await ctx.ui.input("max tokens（回车跳过）", "");
	let maxTokens: number | undefined;
	if (maxRaw && maxRaw.trim() !== "") {
		const n = Number(maxRaw.trim());
		if (isValidPositiveInt(n)) {
			maxTokens = n;
		} else {
			ctx.ui.notify(`无效 max tokens "${maxRaw}"，使用默认。`, "warning");
		}
	}

	const costRaw = await ctx.ui.input(
		"价格（美元 / 百万 token，回车表示未知）",
		"input, output, cacheRead, cacheWrite，例如 3,15,0.3,3.75",
	);
	const cost = parseModelCostInput(costRaw);
	if (costRaw?.trim() && cost === undefined) {
		ctx.ui.notify("价格格式无效，需要四个非负数字；本模型价格将标为未知。", "warning");
	}

	return { id, name, reasoning, input, contextWindow, maxTokens, cost };
}

export function parseModelCostInput(raw: string | undefined): CustomModelCostConfig | undefined {
	if (!raw?.trim()) {
		return undefined;
	}
	const parts = raw.trim().split(/[\s,，]+/u);
	if (parts.length !== 4) {
		return undefined;
	}
	const values = parts.map(Number);
	if (values.some((value) => !Number.isFinite(value) || value < 0)) {
		return undefined;
	}
	const [input, output, cacheRead, cacheWrite] = values;
	if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) {
		return undefined;
	}
	return { input, output, cacheRead, cacheWrite };
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export interface ProviderTransactionOps {
	register(config: CustomProviderConfig): string | undefined;
	unregister(id: string): void;
	persist(): Promise<void>;
	/** 写盘后读取真正生效的 provider；用于识别项目级配置遮蔽用户级修改。 */
	effective?(id: string): CustomProviderConfig | undefined;
}

export type ProviderTransactionResult =
	| { ok: true }
	| { ok: false; phase: "register" | "persist" | "effective"; error: string; restoreError?: string };

function sameProviderConfig(
	left: CustomProviderConfig | undefined,
	right: CustomProviderConfig | undefined,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

export async function saveProviderTransaction(
	next: CustomProviderConfig,
	previous: CustomProviderConfig | undefined,
	ops: ProviderTransactionOps,
): Promise<ProviderTransactionResult> {
	const registrationError = ops.register(next);
	if (registrationError) {
		return { ok: false, phase: "register", error: registrationError };
	}
	try {
		await ops.persist();
		if (ops.effective) {
			const effective = ops.effective(next.id);
			if (!sameProviderConfig(effective, next)) {
				ops.unregister(next.id);
				const restoreError = effective ? ops.register(effective) : undefined;
				return {
					ok: false,
					phase: "effective",
					error: "用户级修改被项目级 providers 覆盖",
					...(restoreError ? { restoreError } : {}),
				};
			}
		}
		return { ok: true };
	} catch (error) {
		ops.unregister(next.id);
		const restoreError = previous ? ops.register(previous) : undefined;
		return {
			ok: false,
			phase: "persist",
			error: errorText(error),
			...(restoreError ? { restoreError } : {}),
		};
	}
}

export async function removeProviderTransaction(
	target: CustomProviderConfig,
	ops: ProviderTransactionOps,
): Promise<ProviderTransactionResult> {
	ops.unregister(target.id);
	try {
		await ops.persist();
		if (ops.effective) {
			const effective = ops.effective(target.id);
			if (effective) {
				const restoreError = ops.register(effective);
				return {
					ok: false,
					phase: "effective",
					error: "用户级修改被项目级 providers 覆盖",
					...(restoreError ? { restoreError } : {}),
				};
			}
		}
		return { ok: true };
	} catch (error) {
		const restoreError = ops.register(target);
		return {
			ok: false,
			phase: "persist",
			error: errorText(error),
			...(restoreError ? { restoreError } : {}),
		};
	}
}

async function installAndSaveProvider(
	ctx: ExtensionContext,
	cfg: CustomProviderConfig,
	previous: CustomProviderConfig | undefined,
): Promise<boolean> {
	const result = await saveProviderTransaction(cfg, previous, {
		register: (config) => registerProviderWithPi(ctx, config),
		unregister: (id) => getAPI().unregisterProvider(id),
		persist: async () => {
			await editConfig(
				ctx,
				(config) => {
					config.providers = config.providers.filter((provider) => provider.id !== cfg.id);
					config.providers.push(cfg);
				},
				{ touched: ["providers"] },
			);
		},
		effective: (id) => getConfig(ctx.cwd, ctx.isProjectTrusted()).providers.find((provider) => provider.id === id),
	});
	if (result.ok) {
		ctx.ui.notify(`厂商 "${cfg.name}" 已注册并保存。`, "info");
		return true;
	}
	ctx.ui.notify(
		result.phase === "register"
			? `注册厂商失败: ${result.error}`
			: result.phase === "effective"
				? `厂商已写入用户级配置，但被项目级 providers 覆盖；已恢复当前运行时配置${result.restoreError ? `，但恢复失败: ${result.restoreError}` : ""}。`
			: `保存厂商失败，已回滚运行时注册: ${result.error}${result.restoreError ? `；恢复旧配置失败: ${result.restoreError}` : ""}`,
		"error",
	);
	return false;
}

export async function editProviderWizard(ctx: ExtensionContext): Promise<void> {
	const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
	if (config.providers.length === 0) {
		ctx.ui.notify("没有自定义厂商可编辑。", "info");
		return;
	}
	const labels = config.providers.map((provider) => `${provider.id} · ${provider.name}`);
	const picked = await ctx.ui.select("选择要编辑的自定义厂商（Esc 取消）", labels);
	const index = picked === undefined ? -1 : labels.indexOf(picked);
	const previous = config.providers[index];
	if (!previous) return;

	const next = await collectProvider(ctx, previous);
	if (!next) return;
	const confirmed = await ctx.ui.confirm(
		"保存厂商修改？",
		`Base URL: ${next.baseUrl}\nAPI Key 环境变量: ${next.apiKeyEnv}\n模型数: ${next.models.length}`,
	);
	if (!confirmed) {
		ctx.ui.notify("已取消，未修改厂商。", "info");
		return;
	}
	await installAndSaveProvider(ctx, next, previous);
}

export interface ProviderConnectionResult {
	ok: boolean;
	message: string;
}

/** 发起一个最多 1 token 的真实请求，验证认证、协议和 Base URL，而不只检查字符串格式。 */
export async function probeProviderConnection(
	ctx: ExtensionContext,
	cfg: CustomProviderConfig,
): Promise<ProviderConnectionResult> {
	const firstModel = cfg.models[0];
	if (!firstModel) return { ok: false, message: "没有可测试的模型" };
	const model = ctx.modelRegistry.find(cfg.id, firstModel.id);
	const provider = ctx.modelRegistry.getProvider(cfg.id);
	if (!model || !provider) {
		return { ok: false, message: "provider 尚未注册到当前会话" };
	}
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) {
		return { ok: false, message: auth.error };
	}

	try {
		const stream = provider.streamSimple(
			model,
			{
				messages: [{ role: "user", content: "Reply with OK.", timestamp: Date.now() }],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				maxTokens: 1,
				signal: AbortSignal.timeout(30_000),
			},
		);
		for await (const event of stream) {
			if (event.type === "done") {
				return { ok: true, message: `${cfg.id}/${firstModel.id} 请求成功` };
			}
			if (event.type === "error") {
				return { ok: false, message: event.error.errorMessage ?? event.reason };
			}
		}
		return { ok: false, message: "响应流未返回完成状态" };
	} catch (error) {
		return { ok: false, message: errorText(error) };
	}
}

export async function testProviderWizard(ctx: ExtensionContext): Promise<void> {
	const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
	if (config.providers.length === 0) {
		ctx.ui.notify("没有自定义厂商可测试。", "info");
		return;
	}
	const labels = config.providers.map((provider) => `${provider.id} · ${provider.name}`);
	const picked = await ctx.ui.select("选择要测试的自定义厂商（会产生一个极小请求）", labels);
	const index = picked === undefined ? -1 : labels.indexOf(picked);
	const target = config.providers[index];
	if (!target) return;
	ctx.ui.notify(`正在测试 ${target.id}/${target.models[0]?.id ?? "?"}…`, "info");
	const result = await probeProviderConnection(ctx, target);
	ctx.ui.notify(result.message, result.ok ? "info" : "error");
}

export async function removeProviderWizard(
	ctx: ExtensionContext,
): Promise<void> {
	const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
	if (config.providers.length === 0) {
		ctx.ui.notify("没有自定义厂商可移除。", "info");
		return;
	}
	const labels = config.providers.map((p) => `${p.id} · ${p.name}`);
	const picked = await ctx.ui.select("选择要移除的自定义厂商（Esc 取消）", labels);
	if (picked === undefined) {
		return;
	}
	const idx = labels.indexOf(picked);
	const target = config.providers[idx];
	if (idx < 0 || target === undefined) {
		return;
	}
	const ok = await ctx.ui.confirm("确认移除", `移除厂商 "${target.name}"？`);
	if (!ok) {
		return;
	}
	const result = await removeProviderTransaction(target, {
		register: (config) => registerProviderWithPi(ctx, config),
		unregister: (id) => getAPI().unregisterProvider(id),
		persist: async () => {
			await editConfig(
				ctx,
				(config) => {
					config.providers = config.providers.filter((p) => p.id !== target.id);
				},
				{ touched: ["providers"] },
			);
		},
		effective: (id) => getConfig(ctx.cwd, ctx.isProjectTrusted()).providers.find((provider) => provider.id === id),
	});
	if (result.ok) {
		ctx.ui.notify(`厂商 "${target.name}" 已移除。`, "info");
	} else if (result.phase === "effective") {
		ctx.ui.notify(
			`移除已写入用户级配置，但被项目级 providers 覆盖；当前运行时仍保留该厂商${result.restoreError ? `，但恢复失败: ${result.restoreError}` : ""}。`,
			"warning",
		);
	} else {
		ctx.ui.notify(
			`移除厂商失败，已恢复运行时注册: ${result.error}${result.restoreError ? `；恢复失败: ${result.restoreError}` : ""}`,
			"error",
		);
	}
}

export function reapplyCustomProviders(
	ctx: ExtensionContext,
	config: PiExtendsConfig,
): string[] {
	const errors: string[] = [];
	for (const cfg of config.providers) {
		const error = registerProviderWithPi(ctx, cfg);
		if (error) {
			errors.push(error);
		}
	}
	return errors;
}
