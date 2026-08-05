import * as fs from "node:fs";
import * as path from "node:path";

export const CONFIG_VERSION = 1;

export const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export const ROLE_NAMES = ["scout", "planner", "worker", "reviewer"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

export const BUILTIN_TOOLS = [
	"read",
	"grep",
	"find",
	"ls",
	"bash",
	"edit",
	"write",
] as const;
export type BuiltinTool = (typeof BUILTIN_TOOLS)[number];

export type ProviderApi =
	| "openai-completions"
	| "openai-responses"
	| "anthropic-messages";

export const PROVIDER_APIS: readonly ProviderApi[] = [
	"openai-completions",
	"openai-responses",
	"anthropic-messages",
];

export type GoalMode = "focused" | "autopilot";

export interface CustomModelConfig {
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	contextWindow?: number;
	maxTokens?: number;
}

export interface CustomProviderConfig {
	id: string;
	name: string;
	baseUrl: string;
	api: ProviderApi;
	apiKeyEnv: string;
	models: CustomModelConfig[];
}

export interface RoleConfig {
	model?: string;
	thinking?: ThinkingLevel;
	tools?: string[];
	systemPrompt?: string;
}

export interface CurrentModelConfig {
	model: string;
	thinking: ThinkingLevel;
}

export interface SubagentLimitsConfig {
	maxParallelTasks: number;
	maxConcurrency: number;
}

export interface GoalConfig {
	defaultMode: GoalMode;
	maxAutoTurns: number;
}

export interface PiExtendsConfig {
	$schema?: string;
	version: number;
	theme: string;
	currentModel: CurrentModelConfig;
	roles: Partial<Record<RoleName, RoleConfig>>;
	providers: CustomProviderConfig[];
	subagents: SubagentLimitsConfig;
	goal: GoalConfig;
}

export interface ConfigLoadResult {
	config: PiExtendsConfig;
	warnings: string[];
}

const TOOL_SET = new Set<string>(BUILTIN_TOOLS);

export function isValidThinkingLevel(v: unknown): v is ThinkingLevel {
	return (
		typeof v === "string" && (THINKING_LEVELS as readonly string[]).includes(v)
	);
}

export function isValidRoleName(v: unknown): v is RoleName {
	return (
		typeof v === "string" && (ROLE_NAMES as readonly string[]).includes(v)
	);
}

export function isValidToolName(v: unknown): v is string {
	return typeof v === "string" && TOOL_SET.has(v);
}

export function isValidProviderApi(v: unknown): v is ProviderApi {
	return (
		typeof v === "string" &&
		(PROVIDER_APIS as readonly string[]).includes(v)
	);
}

export function isValidProviderId(v: unknown): v is string {
	return (
		typeof v === "string" &&
		v.length > 0 &&
		v.length <= 64 &&
		/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(v)
	);
}

export function isValidModelId(v: unknown): v is string {
	return (
		typeof v === "string" &&
		v.length > 0 &&
		v.length <= 200 &&
		/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(v)
	);
}

export function isValidEnvVarName(v: unknown): v is string {
	return (
		typeof v === "string" &&
		v.length > 0 &&
		/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)
	);
}

export function isValidBaseUrl(v: unknown): v is string {
	if (typeof v !== "string" || v.length === 0 || v.length > 2048) {
		return false;
	}
	try {
		const url = new URL(v);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

export function isValidPositiveInt(v: unknown): v is number {
	return typeof v === "number" && Number.isInteger(v) && v > 0;
}

export function defaultConfig(): PiExtendsConfig {
	return {
		$schema: "./schemas/pi-extends.schema.json",
		version: CONFIG_VERSION,
		theme: "pi-carbon",
		currentModel: {
			model: "anthropic/claude-sonnet-4-5",
			thinking: "high",
		},
		roles: {
			scout: {
				model: "google/gemini-2.5-flash",
				thinking: "low",
				tools: ["read", "grep", "find", "ls"],
			},
			planner: {
				model: "openai/gpt-5.2",
				thinking: "high",
				tools: ["read", "grep", "find", "ls"],
			},
			worker: {
				model: "anthropic/claude-sonnet-4-5",
				thinking: "high",
				tools: ["read", "bash", "edit", "write"],
			},
			reviewer: {
				model: "openai/gpt-5.2",
				thinking: "high",
				tools: ["read", "grep", "find", "ls"],
			},
		},
		providers: [],
		subagents: {
			maxParallelTasks: 8,
			maxConcurrency: 4,
		},
		goal: {
			defaultMode: "focused",
			maxAutoTurns: 5,
		},
	};
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asOptionalString(raw: unknown, warnings: string[], field: string): string | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (typeof raw === "string") {
		return raw;
	}
	warnings.push(`${field}: 期望字符串，忽略无效值`);
	return undefined;
}

function asOptionalBool(raw: unknown, warnings: string[], field: string): boolean | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (typeof raw === "boolean") {
		return raw;
	}
	warnings.push(`${field}: 期望布尔值，忽略无效值`);
	return undefined;
}

function sanitizeRole(raw: unknown, warnings: string[], role: string): RoleConfig | undefined {
	if (raw === undefined || raw === null) {
		return undefined;
	}
	if (!isPlainRecord(raw)) {
		warnings.push(`roles.${role}: 期望对象，忽略无效值`);
		return undefined;
	}
	const result: RoleConfig = {};
	const model = asOptionalString(raw.model, warnings, `roles.${role}.model`);
	if (model !== undefined) {
		if (isValidModelId(model)) {
			result.model = model;
		} else {
			warnings.push(`roles.${role}.model: 无效模型 ID "${model}"，忽略`);
		}
	}
	const thinking = asOptionalString(raw.thinking, warnings, `roles.${role}.thinking`);
	if (thinking !== undefined) {
		if (isValidThinkingLevel(thinking)) {
			result.thinking = thinking;
		} else {
			warnings.push(`roles.${role}.thinking: 未知 thinking level "${thinking}"，忽略`);
		}
	}
	if (raw.tools !== undefined) {
		if (Array.isArray(raw.tools)) {
			const tools: string[] = [];
			for (const t of raw.tools) {
				if (isValidToolName(t)) {
					tools.push(t);
				} else {
					warnings.push(`roles.${role}.tools: 未知工具 "${String(t)}"，忽略`);
				}
			}
			result.tools = tools;
		} else {
			warnings.push(`roles.${role}.tools: 期望数组，忽略`);
		}
	}
	const systemPrompt = asOptionalString(raw.systemPrompt, warnings, `roles.${role}.systemPrompt`);
	if (systemPrompt !== undefined) {
		result.systemPrompt = systemPrompt;
	}
	if (Object.keys(result).length === 0) {
		return undefined;
	}
	return result;
}

function sanitizeProvider(raw: unknown, warnings: string[]): CustomProviderConfig | undefined {
	if (!isPlainRecord(raw)) {
		warnings.push("providers: 跳过无效 provider 条目");
		return undefined;
	}
	const id = raw.id;
	if (!isValidProviderId(id)) {
		warnings.push(`providers: 无效 provider ID "${String(id)}"，跳过`);
		return undefined;
	}
	const name = asOptionalString(raw.name, warnings, `providers.${id}.name`) ?? id;
	const baseUrl = raw.baseUrl;
	if (!isValidBaseUrl(baseUrl)) {
		warnings.push(`providers.${id}.baseUrl: 无效 URL "${String(baseUrl)}"，跳过`);
		return undefined;
	}
	const api = raw.api;
	if (!isValidProviderApi(api)) {
		warnings.push(`providers.${id}.api: 未知协议 "${String(api)}"，跳过`);
		return undefined;
	}
	const apiKeyEnv = raw.apiKeyEnv;
	if (!isValidEnvVarName(apiKeyEnv)) {
		warnings.push(`providers.${id}.apiKeyEnv: 无效环境变量名 "${String(apiKeyEnv)}"，跳过`);
		return undefined;
	}
	let models: CustomModelConfig[] = [];
	if (raw.models !== undefined) {
		if (Array.isArray(raw.models)) {
			for (const m of raw.models) {
				if (!isPlainRecord(m)) {
					warnings.push(`providers.${id}.models: 跳过无效模型条目`);
					continue;
				}
				const modelId = m.id;
				if (!isValidModelId(modelId)) {
					warnings.push(`providers.${id}.models: 无效模型 ID "${String(modelId)}"，跳过`);
					continue;
				}
				const entry: CustomModelConfig = { id: modelId };
				const modelName = asOptionalString(m.name, warnings, `providers.${id}.models.${modelId}.name`);
				if (modelName !== undefined) {
					entry.name = modelName;
				}
				const reasoning = asOptionalBool(m.reasoning, warnings, `providers.${id}.models.${modelId}.reasoning`);
				if (reasoning !== undefined) {
					entry.reasoning = reasoning;
				}
				if (m.input !== undefined) {
					if (Array.isArray(m.input)) {
						const input: ("text" | "image")[] = [];
						for (const t of m.input) {
							if (t === "text" || t === "image") {
								input.push(t);
							} else {
								warnings.push(`providers.${id}.models.${modelId}.input: 未知输入类型 "${String(t)}"，忽略`);
							}
						}
						entry.input = input;
					} else {
						warnings.push(`providers.${id}.models.${modelId}.input: 期望数组，忽略`);
					}
				}
				const contextWindow = rawToPositiveInt(m.contextWindow, warnings, `providers.${id}.models.${modelId}.contextWindow`);
				if (contextWindow !== undefined) {
					entry.contextWindow = contextWindow;
				}
				const maxTokens = rawToPositiveInt(m.maxTokens, warnings, `providers.${id}.models.${modelId}.maxTokens`);
				if (maxTokens !== undefined) {
					entry.maxTokens = maxTokens;
				}
				models.push(entry);
			}
		} else {
			warnings.push(`providers.${id}.models: 期望数组，忽略`);
		}
	}
	if (models.length === 0) {
		warnings.push(`providers.${id}: 未提供任何模型，跳过`);
		return undefined;
	}
	return { id, name, baseUrl, api, apiKeyEnv, models };
}

function rawToPositiveInt(raw: unknown, warnings: string[], field: string): number | undefined {
	if (raw === undefined) {
		return undefined;
	}
	if (isValidPositiveInt(raw)) {
		return raw;
	}
	warnings.push(`${field}: 期望正整数，忽略无效值`);
	return undefined;
}

function sanitizeSubagents(raw: unknown, base: SubagentLimitsConfig, warnings: string[]): SubagentLimitsConfig {
	if (!isPlainRecord(raw)) {
		return base;
	}
	return {
		maxParallelTasks: rawToPositiveInt(raw.maxParallelTasks, warnings, "subagents.maxParallelTasks") ?? base.maxParallelTasks,
		maxConcurrency: rawToPositiveInt(raw.maxConcurrency, warnings, "subagents.maxConcurrency") ?? base.maxConcurrency,
	};
}

function sanitizeGoal(raw: unknown, base: GoalConfig, warnings: string[]): GoalConfig {
	if (!isPlainRecord(raw)) {
		return base;
	}
	const mode = asOptionalString(raw.defaultMode, warnings, "goal.defaultMode");
	const maxAutoTurns = rawToPositiveInt(raw.maxAutoTurns, warnings, "goal.maxAutoTurns");
	return {
		defaultMode: mode === "autopilot" ? "autopilot" : mode === "focused" ? "focused" : base.defaultMode,
		maxAutoTurns: maxAutoTurns ?? base.maxAutoTurns,
	};
}

/**
 * 将原始配置整理为完整配置。未出现的字段从 `base` 继承，因此可以链式处理
 * 用户级配置（base=默认值）和项目级配置（base=用户级结果）实现逐字段覆盖。
 */
export function sanitizeConfig(raw: unknown, base: PiExtendsConfig = defaultConfig()): ConfigLoadResult {
	const warnings: string[] = [];
	if (raw === undefined || raw === null) {
		return { config: base, warnings: ["配置为空，使用默认值"] };
	}
	if (!isPlainRecord(raw)) {
		return { config: base, warnings: ["配置不是 JSON 对象，使用默认值"] };
	}

	const version = raw.version;
	if (typeof version === "number" && version !== CONFIG_VERSION) {
		if (version > CONFIG_VERSION) {
			warnings.push(`配置版本 ${version} 高于当前支持版本 ${CONFIG_VERSION}，按最佳努力解析`);
		} else {
			warnings.push(`配置版本 ${version} 已过时，按最佳努力解析`);
		}
	} else if (version !== undefined && typeof version !== "number") {
		warnings.push("version: 期望数字，忽略无效值");
	}

	const theme = asOptionalString(raw.theme, warnings, "theme");
	let currentModel = base.currentModel;
	if (raw.currentModel !== undefined) {
		if (isPlainRecord(raw.currentModel)) {
			const model = asOptionalString(raw.currentModel.model, warnings, "currentModel.model");
			const thinking = asOptionalString(raw.currentModel.thinking, warnings, "currentModel.thinking");
			const next: CurrentModelConfig = { ...base.currentModel };
			if (model !== undefined) {
				if (isValidModelId(model)) {
					next.model = model;
				} else {
					warnings.push(`currentModel.model: 无效模型 ID "${model}"，忽略`);
				}
			}
			if (thinking !== undefined) {
				if (isValidThinkingLevel(thinking)) {
					next.thinking = thinking;
				} else {
					warnings.push(`currentModel.thinking: 未知 thinking level "${thinking}"，忽略`);
				}
			}
			currentModel = next;
		} else {
			warnings.push("currentModel: 期望对象，忽略");
		}
	}

	let roles: Partial<Record<RoleName, RoleConfig>> = { ...base.roles };
	if (raw.roles !== undefined) {
		if (isPlainRecord(raw.roles)) {
			for (const role of ROLE_NAMES) {
				if (raw.roles[role] !== undefined) {
					const value = sanitizeRole(raw.roles[role], warnings, role);
					if (value !== undefined) {
						roles[role] = { ...base.roles[role], ...value };
					}
				}
			}
			for (const key of Object.keys(raw.roles)) {
				if (!isValidRoleName(key)) {
					warnings.push(`roles: 未知角色 "${key}"，忽略`);
				}
			}
		} else {
			warnings.push("roles: 期望对象，忽略");
		}
	}

	let providers: CustomProviderConfig[] = base.providers;
	if (raw.providers !== undefined) {
		if (Array.isArray(raw.providers)) {
			const next: CustomProviderConfig[] = [];
			for (const p of raw.providers) {
				const sanitized = sanitizeProvider(p, warnings);
				if (sanitized !== undefined) {
					next.push(sanitized);
				}
			}
			providers = next;
		} else {
			warnings.push("providers: 期望数组，忽略");
		}
	}

	const subagents = sanitizeSubagents(raw.subagents, base.subagents, warnings);
	const goal = sanitizeGoal(raw.goal, base.goal, warnings);

	return {
		config: {
			$schema: asOptionalString(raw.$schema, warnings, "$schema") ?? base.$schema,
			version: CONFIG_VERSION,
			theme: theme ?? base.theme,
			currentModel,
			roles,
			providers,
			subagents,
			goal,
		},
		warnings,
	};
}

function readJsonFileSync(filePath: string): { raw: unknown; warnings: string[] } {
	try {
		const text = fs.readFileSync(filePath, "utf8");
		const raw = JSON.parse(text);
		return { raw, warnings: [] };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			raw: undefined,
			warnings: [`无法解析配置文件 ${filePath}: ${message}，跳过该文件`],
		};
	}
}

export function loadConfigFiles(opts: {
	userPath?: string;
	projectPath?: string;
}): ConfigLoadResult {
	const warnings: string[] = [];
	let base = defaultConfig();

	if (opts.userPath && fs.existsSync(opts.userPath)) {
		const { raw, warnings: w } = readJsonFileSync(opts.userPath);
		warnings.push(...w);
		const result = sanitizeConfig(raw, base);
		warnings.push(...result.warnings);
		base = result.config;
	}

	if (opts.projectPath && fs.existsSync(opts.projectPath)) {
		const { raw, warnings: w } = readJsonFileSync(opts.projectPath);
		warnings.push(...w);
		const result = sanitizeConfig(raw, base);
		warnings.push(...result.warnings);
		base = result.config;
	}

	return { config: base, warnings };
}

/**
 * 原子写入：先写临时文件再重命名，避免中断造成半写入 JSON。
 */
export async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
	const dir = path.dirname(filePath);
	await fs.promises.mkdir(dir, { recursive: true });
	const tmpPath = path.join(
		dir,
		`.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
	);
	const text = JSON.stringify(data, null, 2) + "\n";
	await fs.promises.writeFile(tmpPath, text, { encoding: "utf8", mode: 0o600 });
	try {
		await fs.promises.rename(tmpPath, filePath);
	} catch (err) {
		await fs.promises.unlink(tmpPath).catch(() => {});
		throw err;
	}
}

export function resolveConfigPaths(cwd: string): {
	userPath: string;
	projectPath: string;
} {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	return {
		userPath: path.join(home, ".pi", "agent", "pi-extends.json"),
		projectPath: path.join(cwd, ".pi", "pi-extends.json"),
	};
}
