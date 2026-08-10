import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_ICON_SET, ICON_SETS, resolveIconSet, type IconSet } from "./icons.ts";
import {
	BORDER_STYLES,
	DEFAULT_BORDER,
	resolveBorderStyle,
	type BorderStyle,
} from "./ui-kit.ts";

export const CONFIG_VERSION = 1;

// 图标集的取值与字形表都归 icons.ts 管，边框样式归 ui-kit.ts 管，
// 这里只做配置字段的校验与透传。
export { ICON_SETS, type IconSet };
export { BORDER_STYLES, type BorderStyle };

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

/**
 * 桌面通知：长任务跑完、旁审报 blocker 时弹一条系统通知。
 *
 * 默认关。开着会在每次符合条件时 fork 一个 `notify-send`/`osascript` 子进程，
 * 而 SSH 进去的机器上根本没有通知守护进程 —— 这类「装完就有副作用」的行为
 * 应当由用户显式打开，和 advisor 同一个取舍。
 */
export interface NotificationsConfig {
	enabled: boolean;
	/** 任务时长低于该秒数不通知：几秒就答完的一轮，人还在屏幕前。 */
	minSeconds: number;
	/** 整轮结束（agent_end）时通知。 */
	onIdle: boolean;
	/** Advisor 报出 blocker 时立刻通知，不受 minSeconds 限制。 */
	onAdvisorBlocker: boolean;
	/** 每个子代理结束时通知。默认关 —— 并行八个会连弹八条。 */
	onSubagent: boolean;
}

/**
 * 编排建议模式。
 * - `off`：不做任何提示。
 * - `suggest`：识别到适合拆分的任务时给出一条建议卡片，用户按键确认才注入指令。
 * - `auto`：直接把编排指令追加到这一轮输入，不再询问。
 */
export const ORCHESTRATION_MODES = ["off", "suggest", "auto"] as const;
export type OrchestrationMode = (typeof ORCHESTRATION_MODES)[number];

export function isValidOrchestrationMode(v: unknown): v is OrchestrationMode {
	return (
		typeof v === "string" && (ORCHESTRATION_MODES as readonly string[]).includes(v)
	);
}

/** 自动分工：识别可并行/可流水线的任务并给出建议或直接编排。 */
export interface OrchestrationConfig {
	mode: OrchestrationMode;
	/** 复杂度评分达到该阈值才提示，避免小任务被打断。 */
	minComplexity: number;
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
	/** 界面图标字形集，见 icons.ts。默认 lucide，需装 Lucide 字体。 */
	icons: IconSet;
	/** 卡片边框样式，见 ui-kit.ts。默认 round。 */
	border: BorderStyle;
	currentModel: CurrentModelConfig;
	roles: Partial<Record<RoleName, RoleConfig>>;
	routes: Partial<Record<RouteName, RouteConfig>>;
	providers: CustomProviderConfig[];
	subagents: SubagentLimitsConfig;
	goal: GoalConfig;
	advisor: AdvisorConfig;
	keywords: KeywordsConfig;
	orchestration: OrchestrationConfig;
	notifications: NotificationsConfig;
}

export interface ConfigLoadResult {
	config: PiExtendsConfig;
	warnings: string[];
}

/** 配置作用域：用户级（~/.pi/agent）或项目级（<cwd>/.pi）。 */
export type ConfigScope = "user" | "project";

/**
 * 合并模式。
 *
 * - `inherit`：未出现的字段从 base 继承。用于加载时叠加「默认 → 用户 → 项目」。
 * - `exact`：只保留 raw 里真实存在的字段，不从 base 回填。用于落盘 ——
 *   否则 `delete config.routes.smol.model` 会被默认值复活，清除操作永远不生效。
 */
export type MergeMode = "inherit" | "exact";

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
		// 只是个占位值。真正写盘的 `$schema` 由 schemaRefFrom() 按目标目录现算，
		// 见那个函数的注释。
		$schema: "./schemas/pi-extends.schema.json",
		version: CONFIG_VERSION,
		theme: "pi-carbon",
		icons: DEFAULT_ICON_SET,
		border: DEFAULT_BORDER,
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
		orchestration: {
			mode: "suggest",
			minComplexity: 3,
		},
		notifications: {
			enabled: false,
			minSeconds: 20,
			onIdle: true,
			onAdvisorBlocker: true,
			onSubagent: false,
		},
	};
}

/**
 * 加载链的起点：标量有兜底值，但 roles/routes/providers 全空。
 *
 * 这里刻意不用 `defaultConfig()`。若加载链从默认值开始，用户「清除 routes.smol 的模型」
 * 写盘后，下次加载又会被默认值填回来 —— 删除操作在语义上无法表达。
 * roles 与 routes 未配置时的行为由读取侧兜底（resolveRoute / roleToolDefault），
 * 因此这里留空是安全的，且「未配置」终于真的等于未配置。
 * `defaultConfig()` 现在只剩测试在用 —— `/config generate` 直接拷
 * `templates/pi-extends.example.json`，不走它。
 */
export function emptyBase(): PiExtendsConfig {
	return {
		version: CONFIG_VERSION,
		theme: "pi-carbon",
		icons: DEFAULT_ICON_SET,
		border: DEFAULT_BORDER,
		currentModel: {
			model: "anthropic/claude-sonnet-4-5",
			thinking: "high",
		},
		roles: {},
		routes: {},
		providers: [],
		subagents: {
			maxParallelTasks: 8,
			maxConcurrency: 4,
		},
		goal: {
			defaultMode: "focused",
			maxAutoTurns: 5,
		},
		advisor: {
			enabled: false,
			minSeverity: "concern",
			maxPerSession: 20,
		},
		keywords: {
			enabled: true,
		},
		orchestration: {
			mode: "suggest",
			minComplexity: 3,
		},
		notifications: {
			enabled: false,
			minSeconds: 20,
			onIdle: true,
			onAdvisorBlocker: true,
			onSubagent: false,
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

function sanitizeNotifications(
	raw: unknown,
	base: NotificationsConfig,
	warnings: string[],
): NotificationsConfig {
	if (raw === undefined) {
		return base;
	}
	if (!isPlainRecord(raw)) {
		warnings.push("notifications: 期望对象，忽略");
		return base;
	}
	// minSeconds 允许 0（每轮都通知），所以不能走 rawToPositiveInt。
	let minSeconds = base.minSeconds;
	if (raw.minSeconds !== undefined) {
		if (typeof raw.minSeconds === "number" && Number.isInteger(raw.minSeconds) && raw.minSeconds >= 0) {
			minSeconds = raw.minSeconds;
		} else {
			warnings.push("notifications.minSeconds: 期望非负整数，忽略无效值");
		}
	}
	return {
		enabled: asOptionalBool(raw.enabled, warnings, "notifications.enabled") ?? base.enabled,
		minSeconds,
		onIdle: asOptionalBool(raw.onIdle, warnings, "notifications.onIdle") ?? base.onIdle,
		onAdvisorBlocker:
			asOptionalBool(raw.onAdvisorBlocker, warnings, "notifications.onAdvisorBlocker") ??
			base.onAdvisorBlocker,
		onSubagent: asOptionalBool(raw.onSubagent, warnings, "notifications.onSubagent") ?? base.onSubagent,
	};
}

function sanitizeOrchestration(
	raw: unknown,
	base: OrchestrationConfig,
	warnings: string[],
): OrchestrationConfig {
	if (raw === undefined) {
		return base;
	}
	if (!isPlainRecord(raw)) {
		warnings.push("orchestration: 期望对象，忽略");
		return base;
	}
	const mode = asOptionalString(raw.mode, warnings, "orchestration.mode");
	let resolved = base.mode;
	if (mode !== undefined) {
		if (isValidOrchestrationMode(mode)) {
			resolved = mode;
		} else {
			warnings.push(`orchestration.mode: 未知模式 "${mode}"，忽略`);
		}
	}
	return {
		mode: resolved,
		minComplexity:
			rawToPositiveInt(raw.minComplexity, warnings, "orchestration.minComplexity") ??
			base.minComplexity,
	};
}

/**
 * 将原始配置整理为完整配置。未出现的字段从 `base` 继承，因此可以链式处理
 * 用户级配置（base=默认值）和项目级配置（base=用户级结果）实现逐字段覆盖。
 */
export function sanitizeConfig(
	raw: unknown,
	base: PiExtendsConfig = emptyBase(),
	mode: MergeMode = "inherit",
): ConfigLoadResult {
	const warnings: string[] = [];
	if (raw === undefined || raw === null) {
		return { config: base, warnings: ["配置为空，使用默认值"] };
	}
	if (!isPlainRecord(raw)) {
		return { config: base, warnings: ["配置不是 JSON 对象，使用默认值"] };
	}
	// exact 模式下 roles/routes 不从 base 继承，这样 delete 才能落盘生效。
	const exact = mode === "exact";

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

	const rawIcons = asOptionalString(raw.icons, warnings, "icons");
	let icons = base.icons;
	if (rawIcons !== undefined) {
		// 用 resolveIconSet 而不是严格相等：这个文件是手写的，"Lucide" 和 " nerd "
		// 是常见笔误，认出来归一化比丢掉再警告有用。归一化后的值会随保存写回文件，
		// 顺手把大小写也纠正了。真正不认识的值才警告。
		const parsed = resolveIconSet(rawIcons);
		if (parsed !== undefined) {
			icons = parsed;
		} else {
			warnings.push(`icons: 未知图标集 "${rawIcons}"，忽略（可选 ${ICON_SETS.join(" / ")}）`);
		}
	}

	// 边框同样宽松解析：理由见上面 icons 那段。
	const rawBorder = asOptionalString(raw.border, warnings, "border");
	let border = base.border;
	if (rawBorder !== undefined) {
		const parsed = resolveBorderStyle(rawBorder);
		if (parsed !== undefined) {
			border = parsed;
		} else {
			warnings.push(
				`border: 未知边框样式 "${rawBorder}"，忽略（可选 ${BORDER_STYLES.join(" / ")}）`,
			);
		}
	}
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

	const roles: Partial<Record<RoleName, RoleConfig>> = exact ? {} : { ...base.roles };
	if (raw.roles !== undefined) {
		if (isPlainRecord(raw.roles)) {
			for (const role of ROLE_NAMES) {
				if (raw.roles[role] !== undefined) {
					const value = sanitizeRole(raw.roles[role], warnings, role);
					if (value !== undefined) {
						roles[role] = exact ? value : { ...base.roles[role], ...value };
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

	const routes: Partial<Record<RouteName, RouteConfig>> = exact ? {} : { ...base.routes };
	if (raw.routes !== undefined) {
		if (isPlainRecord(raw.routes)) {
			for (const route of ROUTE_NAMES) {
				if (raw.routes[route] !== undefined) {
					const value = sanitizeRoute(raw.routes[route], warnings, route);
					if (value !== undefined) {
						routes[route] = exact ? value : { ...base.routes[route], ...value };
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
	const orchestration = sanitizeOrchestration(raw.orchestration, base.orchestration, warnings);
	const notifications = sanitizeNotifications(raw.notifications, base.notifications, warnings);

	return {
		config: {
			$schema: asOptionalString(raw.$schema, warnings, "$schema") ?? base.$schema,
			version: CONFIG_VERSION,
			theme: theme ?? base.theme,
			icons,
			border,
			currentModel,
			roles,
			routes,
			providers,
			subagents,
			goal,
			advisor,
			keywords,
			orchestration,
			notifications,
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

/**
 * 递归求出 `next` 相对 `prev` 的变化，删除表示为 `undefined`。
 *
 * 为什么需要它：cockpit 的 mutate 拿到的是「合并后」的配置，直接把结果写进用户级
 * 会把项目级的值一起抄过去（反向泄漏）。所以只把「这次真正改了什么」应用到目标层。
 * 配置树是纯 JSON（对象 / 数组 / 标量），不需要处理循环引用。
 */
export function diffConfig(prev: unknown, next: unknown): unknown {
	if (Array.isArray(prev) || Array.isArray(next)) {
		// 数组整体替换：providers / fallback 这类语义上是「一个值」，逐项 diff 没有意义。
		return JSON.stringify(prev) === JSON.stringify(next) ? undefined : next;
	}
	if (isPlainRecord(prev) && isPlainRecord(next)) {
		const patch: Record<string, unknown> = {};
		let changed = false;
		for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
			if (!(key in next)) {
				patch[key] = undefined; // 删除
				changed = true;
				continue;
			}
			if (!(key in prev)) {
				patch[key] = next[key];
				changed = true;
				continue;
			}
			const sub = diffConfig(prev[key], next[key]);
			if (sub !== undefined) {
				patch[key] = sub;
				changed = true;
			}
		}
		return changed ? patch : undefined;
	}
	return prev === next ? undefined : next;
}

/**
 * 把 `diffConfig` 的结果应用到一份原始文档上。`undefined` 表示删除该键。
 * 返回新对象，不修改入参。
 */
export function applyPatch(doc: unknown, patch: unknown): unknown {
	if (patch === undefined) {
		return doc;
	}
	if (!isPlainRecord(patch)) {
		return patch;
	}
	const base: Record<string, unknown> = isPlainRecord(doc) ? { ...doc } : {};
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) {
			delete base[key];
		} else if (isPlainRecord(value)) {
			base[key] = applyPatch(base[key], value);
		} else {
			base[key] = value;
		}
	}
	return base;
}

export interface LayeredLoadResult extends ConfigLoadResult {
	/** 用户级原始文档（未与项目层合并），供写回用户级时作为基线。 */
	userRaw: unknown;
	/** 项目级实际参与合并的键，用于提示「你改的值被项目配置覆盖了」。 */
	projectKeys: string[];
}

/** 顶层键中项目配置实际提供了哪些，用于覆盖提示。 */
function topLevelKeys(raw: unknown): string[] {
	if (!isPlainRecord(raw)) {
		return [];
	}
	return Object.keys(raw).filter((k) => k !== "$schema" && k !== "version");
}

export function loadConfigFiles(opts: {
	userPath?: string;
	projectPath?: string;
}): LayeredLoadResult {
	const warnings: string[] = [];
	let base = emptyBase();
	let userRaw: unknown;
	let projectKeys: string[] = [];

	if (opts.userPath && fs.existsSync(opts.userPath)) {
		const { raw, warnings: w } = readJsonFileSync(opts.userPath);
		warnings.push(...w);
		userRaw = raw;
		const result = sanitizeConfig(raw, base);
		warnings.push(...result.warnings);
		base = result.config;
	}

	if (opts.projectPath && fs.existsSync(opts.projectPath)) {
		const { raw, warnings: w } = readJsonFileSync(opts.projectPath);
		warnings.push(...w);
		projectKeys = topLevelKeys(raw);
		const result = sanitizeConfig(raw, base);
		warnings.push(...result.warnings);
		base = result.config;
	}

	return { config: base, warnings, userRaw, projectKeys };
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
	// 先 fsync 再 rename：rename 本身是原子的，但没 fsync 时掉电可能留下空文件。
	const handle = await fs.promises.open(tmpPath, "w", 0o600);
	try {
		await handle.writeFile(text, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await fs.promises.rename(tmpPath, filePath);
	} catch (err) {
		await fs.promises.unlink(tmpPath).catch(() => {});
		throw err;
	}
}

export type GenerateConfigResult =
	| { ok: true; path: string }
	| { ok: false; reason: "untrusted" | "exists"; path: string };

/**
 * 生成项目级示例配置的唯一写入入口。
 *
 * 生成配置会创建项目文件，因而必须先通过 Pi 的项目级信任检查；已有文件也不应
 * 被一个看似无害的示例模板静默覆盖。TUI 确认和命令行 `--force` 都最终调用这里，
 * 避免两条入口的保护策略漂移。
 */
export async function generateExampleConfig(
	cwd: string,
	trusted: boolean,
	options: { force?: boolean } = {},
): Promise<GenerateConfigResult> {
	const { projectPath } = resolveConfigPaths(cwd);
	if (!trusted) {
		return { ok: false, reason: "untrusted", path: projectPath };
	}
	if (!options.force && fs.existsSync(projectPath)) {
		return { ok: false, reason: "exists", path: projectPath };
	}

	const examplePath = path.join(packageRoot(), "templates", "pi-extends.example.json");
	const example = JSON.parse(await fs.promises.readFile(examplePath, "utf8")) as Record<string, unknown>;
	example.$schema = schemaRefFrom(projectPath);
	await atomicWriteJson(projectPath, example);
	return { ok: true, path: projectPath };
}

/** 本包根目录：config.ts 在 <root>/extensions/pi-extends/，往上两级。 */
function packageRoot(): string {
	return path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/**
 * 算出从配置文件所在目录指向本包 schema 的相对路径。
 *
 * 不能写死 `./schemas/pi-extends.schema.json`：配置落在 `<项目>/.pi/`，
 * 编辑器按配置文件自身所在目录解析 `$schema`，找的是 `<项目>/.pi/schemas/...`，
 * 而 schema 实际在 `<项目>/node_modules/pi-extends/schemas/...`。指不到就是静默
 * 不校验 —— 没有报错，只是补全和字段检查全都不工作，很难发现。
 *
 * 用 POSIX 分隔符：`$schema` 是 URI 引用，Windows 上反斜杠不合法。
 * Windows 跨盘时 path.relative 给不出相对路径（返回 `C:\...`），退回 file:// URL ——
 * 否则拼出来的是 `./C:/...` 这种既不是路径也不是 URL 的东西。
 */
export function schemaRefFrom(configPath: string): string {
	const target = path.join(packageRoot(), "schemas", "pi-extends.schema.json");
	const rel = path.relative(path.dirname(configPath), target);
	if (rel === "" || path.isAbsolute(rel)) {
		return pathToFileURL(target).href;
	}
	const posix = rel.split(path.sep).join("/");
	return posix.startsWith(".") ? posix : `./${posix}`;
}

export function resolveConfigPaths(cwd: string): {
	userPath: string;
	projectPath: string;
} {
	// HOME 缺失时退到 os.homedir()，再不行才用 cwd —— 否则 path.join("", ...) 会得到
	// 相对路径 ".pi/agent/pi-extends.json"，把用户级配置写进当前目录。
	const home = process.env.HOME || process.env.USERPROFILE || os.homedir() || cwd;
	return {
		userPath: path.join(home, ".pi", "agent", "pi-extends.json"),
		projectPath: path.join(cwd, ".pi", "pi-extends.json"),
	};
}
