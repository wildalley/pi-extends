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

/**
 * 路由角色：按「用途」而不是「子代理身份」给模型分工，参考 oh-my-pi 的十条路由。
 * 与 ROLE_NAMES（scout/planner/worker/reviewer 四个子代理人格）互不影响：
 * 路由决定「这件事该用哪个模型」，人格决定「子代理拿到什么系统提示词」。
 */
export const ROUTE_NAMES = [
	"default",
	"smol",
	"slow",
	"plan",
	"commit",
	"vision",
	"designer",
	"task",
	"advisor",
	"tiny",
] as const;
export type RouteName = (typeof ROUTE_NAMES)[number];

/** 每条路由的用途说明，供 cockpit 编辑页展示。 */
export const ROUTE_LABELS: Record<RouteName, string> = {
	default: "主线对话与编码",
	smol: "轻量任务 · 便宜快速",
	slow: "深思熟虑 · 难题攻坚",
	plan: "规划与方案设计",
	commit: "提交信息与变更摘要",
	vision: "读图 / 截图理解",
	designer: "UI 与视觉设计",
	task: "子代理任务执行",
	advisor: "旁审第二意见",
	tiny: "标题、分类等极小请求",
};

/**
 * 默认回退链：路由没配模型时按顺序往后找，最后落到 currentModel。
 * default 不设回退，直接落到 currentModel。
 */
export const DEFAULT_ROUTE_FALLBACKS: Record<RouteName, RouteName[]> = {
	default: [],
	smol: ["default"],
	slow: ["default"],
	plan: ["slow", "default"],
	commit: ["smol", "default"],
	vision: ["default"],
	designer: ["slow", "default"],
	task: ["default"],
	advisor: ["slow", "default"],
	tiny: ["smol", "default"],
};

export const ADVISOR_SEVERITIES = ["aside", "concern", "blocker"] as const;
export type AdvisorSeverity = (typeof ADVISOR_SEVERITIES)[number];

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

/** 单条路由：首选模型 + thinking，以及未配置时的回退顺序。 */
export interface RouteConfig {
	model?: string;
	thinking?: ThinkingLevel;
	fallback?: RouteName[];
}

/** Advisor 旁审：每轮结束后让第二个模型只读复查，产出 aside/concern/blocker 卡片。 */
export interface AdvisorConfig {
	enabled: boolean;
	/** 低于该等级的意见不展示。 */
	minSeverity: AdvisorSeverity;
	/** 单个会话最多展示多少条，避免刷屏。 */
	maxPerSession: number;
}

/** 魔法关键词：输入里出现 ultrathink / orchestrate / workflowz 时改写这一轮的行为。 */
export interface KeywordsConfig {
	enabled: boolean;
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
	routes: Partial<Record<RouteName, RouteConfig>>;
	providers: CustomProviderConfig[];
	subagents: SubagentLimitsConfig;
	goal: GoalConfig;
	advisor: AdvisorConfig;
	keywords: KeywordsConfig;
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

export function isValidRouteName(v: unknown): v is RouteName {
	return (
		typeof v === "string" && (ROUTE_NAMES as readonly string[]).includes(v)
	);
}

export function isValidAdvisorSeverity(v: unknown): v is AdvisorSeverity {
	return (
		typeof v === "string" && (ADVISOR_SEVERITIES as readonly string[]).includes(v)
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
		routes: {
			default: { model: "anthropic/claude-sonnet-4-5", thinking: "high" },
			smol: { model: "google/gemini-2.5-flash", thinking: "low" },
			slow: { model: "openai/gpt-5.2", thinking: "max" },
			plan: { thinking: "high" },
			commit: { thinking: "off" },
			vision: { model: "google/gemini-2.5-flash", thinking: "low" },
			designer: {},
			task: { thinking: "medium" },
			advisor: { thinking: "high" },
			tiny: { model: "google/gemini-2.5-flash", thinking: "off" },
		},
		advisor: {
			enabled: false,
			minSeverity: "concern",
			maxPerSession: 20,
		},
		keywords: {
			enabled: true,
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

function sanitizeRoute(raw: unknown, warnings: string[], route: string): RouteConfig | undefined {
	if (raw === undefined || raw === null) {
		return undefined;
	}
	if (!isPlainRecord(raw)) {
		warnings.push(`routes.${route}: 期望对象，忽略无效值`);
		return undefined;
	}
	const result: RouteConfig = {};
	const model = asOptionalString(raw.model, warnings, `routes.${route}.model`);
	if (model !== undefined) {
		if (isValidModelId(model)) {
			result.model = model;
		} else {
			warnings.push(`routes.${route}.model: 无效模型 ID "${model}"，忽略`);
		}
	}
	const thinking = asOptionalString(raw.thinking, warnings, `routes.${route}.thinking`);
	if (thinking !== undefined) {
		if (isValidThinkingLevel(thinking)) {
			result.thinking = thinking;
		} else {
			warnings.push(`routes.${route}.thinking: 未知 thinking level "${thinking}"，忽略`);
		}
	}
	if (raw.fallback !== undefined) {
		if (Array.isArray(raw.fallback)) {
			const chain: RouteName[] = [];
			for (const f of raw.fallback) {
				if (!isValidRouteName(f)) {
					warnings.push(`routes.${route}.fallback: 未知路由 "${String(f)}"，忽略`);
				} else if (f === route) {
					warnings.push(`routes.${route}.fallback: 不能回退到自己，忽略`);
				} else if (!chain.includes(f)) {
					chain.push(f);
				}
			}
			result.fallback = chain;
		} else {
			warnings.push(`routes.${route}.fallback: 期望数组，忽略`);
		}
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

function sanitizeAdvisor(raw: unknown, base: AdvisorConfig, warnings: string[]): AdvisorConfig {
	if (raw === undefined) {
		return base;
	}
	if (!isPlainRecord(raw)) {
		warnings.push("advisor: 期望对象，忽略");
		return base;
	}
	const enabled = asOptionalBool(raw.enabled, warnings, "advisor.enabled");
	const severity = asOptionalString(raw.minSeverity, warnings, "advisor.minSeverity");
	let minSeverity = base.minSeverity;
	if (severity !== undefined) {
		if (isValidAdvisorSeverity(severity)) {
			minSeverity = severity;
		} else {
			warnings.push(`advisor.minSeverity: 未知等级 "${severity}"，忽略`);
		}
	}
	return {
		enabled: enabled ?? base.enabled,
		minSeverity,
		maxPerSession:
			rawToPositiveInt(raw.maxPerSession, warnings, "advisor.maxPerSession") ?? base.maxPerSession,
	};
}

function sanitizeKeywords(raw: unknown, base: KeywordsConfig, warnings: string[]): KeywordsConfig {
	if (raw === undefined) {
		return base;
	}
	if (!isPlainRecord(raw)) {
		warnings.push("keywords: 期望对象，忽略");
		return base;
	}
	return {
		enabled: asOptionalBool(raw.enabled, warnings, "keywords.enabled") ?? base.enabled,
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

	const routes: Partial<Record<RouteName, RouteConfig>> = { ...base.routes };
	if (raw.routes !== undefined) {
		if (isPlainRecord(raw.routes)) {
			for (const route of ROUTE_NAMES) {
				if (raw.routes[route] !== undefined) {
					const value = sanitizeRoute(raw.routes[route], warnings, route);
					if (value !== undefined) {
						routes[route] = { ...base.routes[route], ...value };
					}
				}
			}
			for (const key of Object.keys(raw.routes)) {
				if (!isValidRouteName(key)) {
					warnings.push(`routes: 未知路由 "${key}"，忽略`);
				}
			}
		} else {
			warnings.push("routes: 期望对象，忽略");
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
	const advisor = sanitizeAdvisor(raw.advisor, base.advisor, warnings);
	const keywords = sanitizeKeywords(raw.keywords, base.keywords, warnings);

	return {
		config: {
			$schema: asOptionalString(raw.$schema, warnings, "$schema") ?? base.$schema,
			version: CONFIG_VERSION,
			theme: theme ?? base.theme,
			currentModel,
			roles,
			routes,
			providers,
			subagents,
			goal,
			advisor,
			keywords,
		},
		warnings,
	};
}

/** 解析路由的结果：最终使用的模型、thinking，以及实际命中的路由名。 */
export interface ResolvedRoute {
	route: RouteName | null;
	model: string;
	thinking: ThinkingLevel;
}

/**
 * 沿回退链解析路由。首选路由没配 model 时依次尝试 fallback（未显式配置则用
 * DEFAULT_ROUTE_FALLBACKS），全部落空则回到 currentModel。
 * thinking 取「第一个显式配置了 thinking 的路由」，与 model 可以来自不同路由：
 * 例如 plan 只配了 thinking: high，模型就沿 slow → default 找，thinking 仍是 high。
 */
export function resolveRoute(config: PiExtendsConfig, route: RouteName): ResolvedRoute {
	const seen = new Set<RouteName>();
	const queue: RouteName[] = [route];
	let model: string | undefined;
	let thinking: ThinkingLevel | undefined;
	let hit: RouteName | null = null;
	while (queue.length > 0) {
		const name = queue.shift() as RouteName;
		if (seen.has(name)) {
			continue;
		}
		seen.add(name);
		const entry = config.routes[name];
		if (entry?.thinking !== undefined && thinking === undefined) {
			thinking = entry.thinking;
		}
		if (entry?.model !== undefined && model === undefined) {
			model = entry.model;
			hit = name;
			break;
		}
		queue.push(...(entry?.fallback ?? DEFAULT_ROUTE_FALLBACKS[name]));
	}
	return {
		route: hit,
		model: model ?? config.currentModel.model,
		thinking: thinking ?? config.currentModel.thinking,
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
