/**
 * 主流 coding plan 目录。
 *
 * 这里刻意**不**把这些厂商注册成自定义 provider —— pi 的内置目录里已经有它们了
 * （`anthropic` / `openai-codex` / `kimi-coding` / `zai` / `opencode` …），
 * 再注册一遍只会覆盖掉 pi 维护的模型表和价格，还得我们自己跟着上游更新。
 *
 * 真正缺的东西是「发现」：pi 装好之后一个模型都没有，用户看到的是
 * `Warning: No models available. Use /login ...`，但不知道自己那份订阅
 * （Claude Pro / ChatGPT Plus / Kimi / GLM 编码套餐）对应哪个 provider id、
 * 是走 OAuth 还是环境变量。这张表补的就是这一段。
 *
 * 设计上只把「pi 不知道的东西」写死在这里：套餐的通俗叫法、地区变体、环境变量名。
 * 认证方式（能不能用订阅、能不能交互式填 key）一律现从 provider 对象上读 ——
 * 早先版本我把它写成了静态枚举，结果 kimi-coding 上线 OAuth 之后目录就在骗人。
 */

import type {
	ExtensionCommandContext,
	ExtensionContext,
	Theme,
} from "@earendil-works/pi-coding-agent";
import { kv, runInfoPage, runMenu, sep, type MenuItem } from "./ui-kit.ts";

export interface CodingPlan {
	/** pi 内置的 provider id，`/login` 和 modelRegistry 都用这个。 */
	id: string;
	/** 菜单里显示的名字，用用户会用的叫法。 */
	label: string;
	/** 订阅/套餐的通俗说法，帮用户认出「我买的是这个」。 */
	plan: string;
	/**
	 * 非交互认证用的环境变量名。
	 *
	 * provider 对象上读不到这个（它藏在 pi-ai 的 env-api-keys 里，没导出），
	 * 所以只能抄一份。tests/plans.test.ts 会拿 `findEnvKeys` 校验每一条，
	 * 上游改名就会红。纯 OAuth 的厂商没有这一项。
	 */
	env?: string;
	/** 同一家的地区变体（国内站 / 海外站），列出来免得选错。 */
	region?: string;
	group: string;
}

/**
 * 目录按「用户会怎么称呼它」排，不按 provider id 排。
 * 例如 ChatGPT 订阅对应的 id 是 `openai-codex`，光看 id 认不出来。
 *
 * 分组用「能不能用订阅额度」划：买了套餐的人找第一组，按量付费的找第三组。
 */
export const CODING_PLANS: readonly CodingPlan[] = [
	// —— 订阅 / 套餐（登录后用额度，不另外按 token 付费）——
	{
		id: "anthropic",
		label: "Claude",
		plan: "Claude Pro / Max",
		env: "ANTHROPIC_API_KEY",
		group: "订阅套餐",
	},
	{
		id: "openai-codex",
		label: "ChatGPT",
		plan: "ChatGPT Plus / Pro（Codex）",
		group: "订阅套餐",
	},
	{
		id: "kimi-coding",
		label: "Kimi",
		plan: "Kimi For Coding",
		env: "KIMI_API_KEY",
		group: "订阅套餐",
	},
	{
		id: "github-copilot",
		label: "GitHub Copilot",
		plan: "Copilot 订阅",
		group: "订阅套餐",
	},
	{
		id: "xai",
		label: "xAI Grok",
		plan: "X / SuperGrok 订阅",
		env: "XAI_API_KEY",
		group: "订阅套餐",
	},
	{
		id: "openrouter",
		label: "OpenRouter",
		plan: "OAuth 换取 API Key，按额度计费",
		env: "OPENROUTER_API_KEY",
		group: "订阅套餐",
	},
	{
		id: "radius",
		label: "Radius",
		plan: "pi-messages 网关",
		env: "RADIUS_API_KEY",
		group: "订阅套餐",
	},

	// —— 编码套餐（买的是包月额度，但只认 API Key）——
	{
		id: "zai",
		label: "GLM / 智谱",
		plan: "ZAI Coding Plan",
		env: "ZAI_API_KEY",
		region: "海外站",
		group: "编码套餐",
	},
	{
		id: "zai-coding-cn",
		label: "GLM / 智谱",
		plan: "ZAI Coding Plan",
		env: "ZAI_CODING_CN_API_KEY",
		region: "国内站",
		group: "编码套餐",
	},
	{
		id: "opencode",
		label: "OpenCode Zen",
		plan: "OpenCode 套餐",
		env: "OPENCODE_API_KEY",
		group: "编码套餐",
	},
	{
		// 和 opencode 共用 OPENCODE_API_KEY，端点不同。
		id: "opencode-go",
		label: "OpenCode Go",
		plan: "OpenCode 套餐",
		env: "OPENCODE_API_KEY",
		group: "编码套餐",
	},
	{
		id: "qwen-token-plan",
		label: "Qwen 通义",
		plan: "Qwen Token Plan",
		env: "QWEN_TOKEN_PLAN_API_KEY",
		region: "海外站",
		group: "编码套餐",
	},
	{
		id: "qwen-token-plan-cn",
		label: "Qwen 通义",
		plan: "Qwen Token Plan",
		env: "QWEN_TOKEN_PLAN_CN_API_KEY",
		region: "国内站",
		group: "编码套餐",
	},
	{
		id: "xiaomi-token-plan-cn",
		label: "Xiaomi MiMo",
		plan: "MiMo Token Plan",
		env: "XIAOMI_TOKEN_PLAN_CN_API_KEY",
		region: "国内站",
		group: "编码套餐",
	},

	// —— 直连 API（按量付费）——
	{
		id: "openai",
		label: "OpenAI",
		plan: "按量计费",
		env: "OPENAI_API_KEY",
		group: "直连 API",
	},
	{
		id: "google",
		label: "Google Gemini",
		plan: "按量计费",
		env: "GEMINI_API_KEY",
		group: "直连 API",
	},
	{
		id: "deepseek",
		label: "DeepSeek",
		plan: "按量计费",
		env: "DEEPSEEK_API_KEY",
		group: "直连 API",
	},
	{
		id: "moonshotai",
		label: "Moonshot",
		plan: "按量计费",
		env: "MOONSHOT_API_KEY",
		region: "海外站",
		group: "直连 API",
	},
	{
		// 和海外站共用 MOONSHOT_API_KEY，端点不同。
		id: "moonshotai-cn",
		label: "Moonshot",
		plan: "按量计费",
		env: "MOONSHOT_API_KEY",
		region: "国内站",
		group: "直连 API",
	},
	{
		id: "minimax",
		label: "MiniMax",
		plan: "按量计费",
		env: "MINIMAX_API_KEY",
		group: "直连 API",
	},
	{
		id: "groq",
		label: "Groq",
		plan: "按量计费",
		env: "GROQ_API_KEY",
		group: "直连 API",
	},
];

/**
 * 除了 `CodingPlan.env`，pi 还认的等价变量。
 *
 * 只影响「变量已设置吗」这个提示：anthropic 的用户很可能设的是 AUTH_TOKEN，
 * 这时候显示「未设置」是错的。真正的认证判定始终来自 pi，这里只管提示。
 */
const ENV_ALIASES: Record<string, readonly string[]> = {
	anthropic: ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_OAUTH_TOKEN"],
};

export interface PlanStatus {
	plan: CodingPlan;
	/** 这个 pi 版本带这个 provider 吗。 */
	registered: boolean;
	/** 已经能用了吗（pi 说的，不是我们猜的）。 */
	authenticated: boolean;
	/** pi 从哪儿拿到的凭据，用来区分「auth.json」和「环境变量」。 */
	source?: string;
	modelCount: number;
	/** 环境变量当前有值吗 —— 「配了但没生效」和「没配」要能分清。 */
	envSet: boolean;
	/** 支持订阅登录吗（现从 provider 上读）。 */
	subscription: boolean;
	/** `/login` 里能交互式填 API Key 吗。 */
	keyLogin: boolean;
}

/** 现查每个套餐的真实状态，不缓存、不猜。 */
export function collectPlanStatus(ctx: ExtensionContext): PlanStatus[] {
	const all = ctx.modelRegistry.getAll();
	return CODING_PLANS.map((plan) => {
		// getProvider 覆盖内置厂商；getRegisteredProviderIds 只返回扩展注册的，
		// 拿它判断内置厂商会把所有套餐都误判成「未提供」。
		const provider = ctx.modelRegistry.getProvider(plan.id);
		const auth = provider ? ctx.modelRegistry.getProviderAuthStatus(plan.id) : undefined;
		return {
			plan,
			registered: !!provider,
			authenticated: auth?.configured ?? false,
			source: auth?.source,
			modelCount: all.filter((m) => m.provider === plan.id).length,
			envSet: envVarsOf(plan).some((name) => !!process.env[name]),
			subscription: !!provider?.auth.oauth,
			keyLogin: !!provider?.auth.apiKey?.login,
		};
	});
}

/** 该套餐主用的环境变量名，纯 OAuth 的没有。 */
export function envOf(plan: CodingPlan): string | undefined {
	return plan.env;
}

/** 主变量 + 等价别名，用于「有没有配」的探测。 */
export function envVarsOf(plan: CodingPlan): string[] {
	return [...(plan.env ? [plan.env] : []), ...(ENV_ALIASES[plan.id] ?? [])];
}

/** 认证方式短标签。按 provider 的真实能力算，列表里够窄。 */
export function authLabel(row: PlanStatus): string {
	if (row.subscription && (row.keyLogin || row.plan.env)) return "订阅 / Key";
	if (row.subscription) return "订阅登录";
	return "API Key";
}

/** 各家的坑，全部抄自 pi 自己的 docs/providers.md。 */
const NOTES: Record<string, string> = {
	"openai-codex": "需要 ChatGPT Plus 或 Pro 订阅",
	anthropic: "Claude Pro/Max 走「额外用量」按 token 计费，不占套餐额度",
	"github-copilot": "回车用 github.com，或填企业版域名；若报 model not supported，去 VS Code 的 Copilot Chat 里启用该模型",
	openrouter: "SSH 等打不开浏览器的环境：把回调 URL 或授权码粘回提示框",
	xai: "登录后选「Sign in with SuperGrok or X Premium」",
	"kimi-coding": "登录后选「Sign in with Kimi Code」",
};

/**
 * 开通指引。
 *
 * 第一条永远是 `/login <id>`：它对所有 provider 都有效，API Key 也能通过它存进
 * auth.json，不用碰环境变量。环境变量作为「非交互 / CI」的备选列在后面。
 */
export function setupSteps(row: PlanStatus): string[] {
	const { plan } = row;
	const steps = [`在输入框执行  /login ${plan.id}`];

	if (row.subscription && row.keyLogin) {
		steps.push("  里面可以选「用订阅」或「用 API Key」");
	} else if (row.subscription) {
		steps.push("  浏览器完成授权，令牌存 auth.json 并自动刷新");
	} else {
		steps.push("  粘贴 API Key，存进 auth.json（0600 权限）");
	}

	const note = NOTES[plan.id];
	if (note) steps.push(`  ${note}`);

	if (plan.env) {
		steps.push(`或者用环境变量：export ${plan.env}=...  然后重启 pi`);
		const aliases = ENV_ALIASES[plan.id];
		if (aliases) steps.push(`  也认 ${aliases.join(" / ")}`);
		steps.push(`  auth.json 里的 "${plan.id}" 优先于环境变量`);
	} else {
		steps.push("这家没有环境变量，只能走 /login");
	}
	return steps;
}

/** 用户可能用的别名，只为搜索服务：搜 glm 要能命中 zai。 */
const ALIASES: Record<string, string> = {
	anthropic: "claude sonnet opus 克劳德",
	"openai-codex": "chatgpt codex gpt plus 订阅",
	zai: "glm 智谱 zhipu",
	"zai-coding-cn": "glm 智谱 zhipu 国内",
	"kimi-coding": "kimi 月之暗面 moonshot",
	moonshotai: "kimi 月之暗面",
	"moonshotai-cn": "kimi 月之暗面",
	"qwen-token-plan": "qwen 通义 千问 阿里 alibaba",
	"qwen-token-plan-cn": "qwen 通义 千问 阿里 alibaba 国内",
	"xiaomi-token-plan-cn": "xiaomi 小米 mimo",
	google: "gemini 谷歌",
	xai: "grok 马斯克",
	"github-copilot": "copilot github 微软",
	opencode: "opencode zen",
	"opencode-go": "opencode go",
	deepseek: "深度求索 ds",
	minimax: "海螺",
	openai: "gpt o3",
};

function planItems(rows: PlanStatus[]): MenuItem[] {
	return rows.map((row) => {
		const status = statusOf(row);
		const name = row.plan.region ? `${row.plan.label}（${row.plan.region}）` : row.plan.label;
		return {
			id: row.plan.id,
			group: row.plan.group,
			icon: row.authenticated ? "◉" : "○",
			label: name,
			value: status.text,
			tone: status.tone,
			hint: `${row.plan.plan} · ${authLabel(row)} · id ${row.plan.id}`,
			keywords: `${row.plan.id} ${row.plan.plan} ${row.plan.env ?? ""} ${ALIASES[row.plan.id] ?? ""}`,
		};
	});
}

function statusSummary(theme: Theme, rows: PlanStatus[]): string[] {
	const ready = rows.filter((r) => r.authenticated);
	const models = ready.reduce((sum, r) => sum + r.modelCount, 0);
	const stuck = rows.filter((r) => !r.authenticated && r.envSet);
	const lines = [
		kv(
			theme,
			"◉",
			"已开通",
			ready.length === 0
				? theme.fg("warning", "一个都没有 —— 选一项，回车照着做")
				: `${theme.fg("success", `${ready.length} 家`)}${sep(theme)}${theme.fg("text", `${models} 个模型可用`)}`,
		),
	];
	if (ready.length > 0) {
		lines.push(
			kv(
				theme,
				"▸",
				"可用",
				ready.map((r) => theme.fg("text", r.plan.id)).join(sep(theme, false)),
			),
		);
	}
	if (stuck.length > 0) {
		// 这条最值得单独提：变量配了却没生效，用户往往以为是 pi 的问题。
		lines.push(
			kv(
				theme,
				"!",
				"待排查",
				`${stuck.map((r) => theme.fg("warning", r.plan.id)).join(sep(theme, false))}${theme.fg("dim", "  变量已设但未生效")}`,
			),
		);
	}
	return lines;
}

/**
 * Coding Plan 目录页。
 *
 * 返回 false 表示已经把 `/login` 填进输入框，控制台该关掉让用户回车执行。
 */
export async function openPlansPage(ctx: ExtensionCommandContext): Promise<boolean> {
	if (ctx.mode !== "tui") {
		const rows = collectPlanStatus(ctx);
		ctx.ui.notify(
			rows
				.map((r) => `${r.plan.label} (${r.plan.id}) · ${statusOf(r).text} · ${authLabel(r)}`)
				.join("\n"),
			"info",
		);
		return true;
	}
	while (true) {
		const rows = collectPlanStatus(ctx);
		const ready = rows.filter((r) => r.authenticated).length;
		const picked = await runMenu(ctx, {
			title: "Coding Plan 与 API",
			titleRight: `${ready}/${rows.length} 已开通`,
			status: (theme) => statusSummary(theme, rows),
			items: planItems(rows),
			tabs: true,
			mouse: true,
			// 搜索常开：用户按自己的叫法找（glm / 通义 / copilot），不该先猜分组。
			search: "always",
			// 同 cockpit：overlay 超高会把底部提示行吃掉，留一行余量。
			reserved: 15,
		});
		if (picked === undefined) {
			return true;
		}
		const row = rows.find((r) => r.plan.id === picked);
		if (row && (await planDetail(ctx, row))) {
			return false;
		}
	}
}

/** 单个套餐的详情页。返回 true 表示已把命令填进输入框。 */
async function planDetail(ctx: ExtensionCommandContext, row: PlanStatus): Promise<boolean> {
	const { plan } = row;
	const items: MenuItem[] = [
		{
			id: "login",
			icon: "▸",
			label: `把 /login ${plan.id} 填进输入框`,
			hotkey: "1",
			hint: "关闭控制台后回车执行",
		},
		{ id: "steps", icon: "▤", label: "开通步骤", hotkey: "2", hint: authLabel(row) },
	];
	if (row.modelCount > 0) {
		items.push({
			id: "models",
			icon: "◆",
			label: "该厂商的模型",
			hotkey: "3",
			value: `${row.modelCount} 个`,
		});
	}
	const picked = await runMenu(ctx, {
		title: plan.region ? `${plan.label}（${plan.region}）` : plan.label,
		titleRight: statusOf(row).text,
		status: (theme) => detailLines(theme, row),
		items,
		reserved: 12,
	});
	if (picked === "login") {
		ctx.ui.setEditorText(`/login ${plan.id}`);
		ctx.ui.notify(`已填入 /login ${plan.id}，回车执行。`, "info");
		return true;
	}
	if (picked === "steps") {
		const theme = ctx.ui.theme;
		await runInfoPage(ctx, {
			title: `开通 ${plan.label}`,
			titleRight: plan.plan,
			lines: setupSteps(row).map((s) =>
				s.startsWith("  ") ? theme.fg("dim", s) : theme.fg("text", s),
			),
		});
	} else if (picked === "models") {
		await modelsPage(ctx, plan);
	}
	return false;
}

function detailLines(theme: Theme, row: PlanStatus): string[] {
	const { plan } = row;
	const status = statusOf(row);
	const lines = [
		kv(theme, "▣", "套餐", theme.fg("text", plan.plan)),
		kv(
			theme,
			"◈",
			"provider",
			`${theme.fg("text", plan.id)}${theme.fg("dim", `  ${authLabel(row)}`)}`,
		),
		kv(theme, status.tone === "success" ? "◉" : "○", "状态", theme.fg(status.tone, status.text)),
	];
	if (plan.env) {
		lines.push(
			kv(
				theme,
				"$",
				"变量",
				`${theme.fg("text", plan.env)}${sep(theme)}${theme.fg(row.envSet ? "success" : "dim", row.envSet ? "已设置" : "未设置")}`,
			),
		);
	}
	return lines;
}

async function modelsPage(ctx: ExtensionCommandContext, plan: CodingPlan): Promise<void> {
	const theme = ctx.ui.theme;
	const models = ctx.modelRegistry.getAll().filter((m) => m.provider === plan.id);
	if (models.length === 0) {
		ctx.ui.notify("该厂商当前没有可用模型。", "info");
		return;
	}
	await runInfoPage(ctx, {
		title: `${plan.label} 的模型`,
		titleRight: `${models.length} 个`,
		lines: models.map((m) => `${theme.fg("accent", "◆")} ${theme.fg("text", m.id)}`),
	});
}

/** 一行状态描述 + 颜色。四种状态要能一眼区分。 */
export function statusOf(row: PlanStatus): { text: string; tone: "success" | "warning" | "muted" } {
	if (row.authenticated) {
		const via = row.source === "environment" ? "变量" : row.source === "stored" ? "已登录" : undefined;
		return {
			text: `${via ? `${via} · ` : ""}${row.modelCount} 模型`,
			tone: "success",
		};
	}
	if (!row.registered) {
		// 这个 pi 版本没带这个 provider，升级 pi 才会出现。
		return { text: "本版本未提供", tone: "muted" };
	}
	if (row.envSet) {
		// 变量有值但 pi 说没认证：key 无效，或者变量是 pi 启动之后才导出的。
		return { text: "变量已设但未生效", tone: "warning" };
	}
	return { text: "未认证", tone: "muted" };
}
