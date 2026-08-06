import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	isValidEnvVarName,
	isValidModelId,
	isValidPositiveInt,
	isValidProviderId,
	type CustomModelConfig,
	type CustomProviderConfig,
	type PiExtendsConfig,
} from "./config.ts";
import { getAPI } from "./runtime.ts";
import { getConfig, updateConfig } from "./store.ts";
import { kv, runInfoPage } from "./ui-kit.ts";

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
			].join(theme.fg("borderMuted", "  ·  ")),
		),
	);
	await runInfoPage(ctx, {
		title: "厂商认证状态",
		titleRight: `${authed}/${rows.length} 已认证`,
		lines,
	});
}

function registerProviderWithPi(
	ctx: ExtensionContext,
	cfg: CustomProviderConfig,
): string | undefined {
	try {
		getAPI().registerProvider(cfg.id, {
			name: cfg.name,
			baseUrl: cfg.baseUrl,
			apiKey: `$${cfg.apiKeyEnv}`,
			api: cfg.api,
			models: cfg.models.map((m) => ({
				id: m.id,
				name: m.name ?? m.id,
				reasoning: m.reasoning ?? false,
				input: m.input && m.input.length > 0 ? m.input : ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: m.contextWindow ?? 128000,
				maxTokens: m.maxTokens ?? 4096,
			})),
		});
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

	const confirmed = await ctx.ui.confirm(
		"确认厂商",
		`Base URL: ${cfg.baseUrl}\nAPI Key 环境变量: ${cfg.apiKeyEnv}\n模型数: ${cfg.models.length}`,
	);
	if (!confirmed) {
		ctx.ui.notify("已取消，未保存。", "info");
		return;
	}

	const error = registerProviderWithPi(ctx, cfg);
	if (error) {
		ctx.ui.notify(`注册厂商失败: ${error}`, "error");
		return;
	}

	await updateConfig(ctx.cwd, ctx.isProjectTrusted(), (config) => {
		config.providers = config.providers.filter((p) => p.id !== cfg.id);
		config.providers.push(cfg);
	});
	ctx.ui.notify(`厂商 "${cfg.name}" 已注册并保存。`, "info");
}

async function collectProvider(
	ctx: ExtensionContext,
): Promise<CustomProviderConfig | undefined> {
	const idInput = await ctx.ui.input("Provider ID", "如 my-proxy");
	if (idInput === undefined || idInput.trim() === "") {
		return undefined;
	}
	const id = idInput.trim();
	if (!isValidProviderId(id)) {
		ctx.ui.notify(`无效 Provider ID "${id}"。`, "error");
		return undefined;
	}
	const name = (await ctx.ui.input("显示名称", id))?.trim() || id;

	const baseUrlInput = await ctx.ui.input("Base URL", "https://api.example.com/v1");
	if (baseUrlInput === undefined) {
		return undefined;
	}
	const baseUrl = baseUrlInput.trim();
	try {
		const url = new URL(baseUrl);
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			throw new Error("protocol");
		}
	} catch {
		ctx.ui.notify(`无效 Base URL "${baseUrl}"。`, "error");
		return undefined;
	}

	const api = await ctx.ui.select("API 协议", [
		"openai-completions",
		"openai-responses",
		"anthropic-messages",
	]);
	if (
		api !== "openai-completions" &&
		api !== "openai-responses" &&
		api !== "anthropic-messages"
	) {
		return undefined;
	}

	const envInput = await ctx.ui.input("API Key 环境变量名", "MY_LLM_API_KEY");
	if (envInput === undefined) {
		return undefined;
	}
	const apiKeyEnv = envInput.trim();
	if (!isValidEnvVarName(apiKeyEnv)) {
		ctx.ui.notify(`无效环境变量名 "${apiKeyEnv}"。`, "error");
		return undefined;
	}

	const models: CustomModelConfig[] = [];
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

	return { id, name, baseUrl, api, apiKeyEnv, models };
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

	return { id, name, reasoning, contextWindow, maxTokens };
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
	getAPI().unregisterProvider(target.id);
	await updateConfig(ctx.cwd, ctx.isProjectTrusted(), (config) => {
		config.providers = config.providers.filter((p) => p.id !== target.id);
	});
	ctx.ui.notify(`厂商 "${target.name}" 已移除。`, "info");
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
