/**
 * pi-extends 控制台（/cockpit）。
 *
 * 一张卡片式面板：顶部是实时状态区（模型 / 运行态 / 上下文占用），
 * 主体是按「外观 · 模型 · 工作流 · 系统」分组的菜单，每项右侧直接显示当前值，
 * 不进子菜单也能看清整套配置。所有子界面复用 ui-kit 的选择器与信息页。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionCommandContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { ROLE_NAMES, ROUTE_NAMES, resolveRoute, type PiExtendsConfig, type RoleName } from "./config.ts";
import { advisorController, setAdvisorEnabled, setAdvisorSeverity } from "./advisor.ts";
import { ADVISOR_SEVERITIES, ORCHESTRATION_MODES, type AdvisorSeverity, type OrchestrationMode } from "./config.ts";
import { editConfig } from "./config-ui.ts";
import { footerController } from "./footer.ts";
import { getGoalState, runGoalCommand } from "./goal-mode.ts";
import { KEYWORD_HINTS, MAGIC_KEYWORDS } from "./keywords.ts";
import { isPlanExecuting, isPlanModeActive, planController } from "./plan-mode.ts";
import { collectPlanStatus, openPlansPage } from "./plans.ts";
import {
	THINKING_HINTS,
	findModelById,
	fmtTokens,
	modelIdOf,
	pickModelId,
	pickThinking,
	shortModel,
	thinkingTone,
} from "./pickers.ts";
import {
	addProviderWizard,
	collectProviderStatus,
	providerStatusPage,
	removeProviderWizard,
} from "./providers.ts";
import {
	describeRole,
	editRoleWizard,
	resolveRoleModel,
	resolveRoleThinking,
	resolveRoleTools,
} from "./roles.ts";
import { customizedRouteCount, describeRoutes, routesWizard } from "./routes.ts";
import { getAPI } from "./runtime.ts";
import { getConfig, reload } from "./store.ts";
import { runSubagentLauncher } from "./subagents.ts";
import {
	badge,
	gauge,
	kv,
	runInfoPage,
	runMenu,
	runPrompt,
	sep,
	type MenuItem,
} from "./ui-kit.ts";

const PROMPTS_DIR = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"prompts",
);

const WORKFLOW_PROMPTS: { id: string; hint: string }[] = [
	{ id: "scout-and-plan", hint: "并行侦察代码库 → 产出实施计划" },
	{ id: "implement", hint: "按计划分派 worker 逐步实现" },
	{ id: "implement-and-review", hint: "实现完成后自动交给 reviewer 复审" },
];

/** 记住上次停留的菜单项，从子菜单返回时光标不跳回顶部。 */
let lastCockpitItem: string | undefined;

function goalTone(status: string): ThemeColor {
	switch (status) {
		case "active":
			return "success";
		case "paused":
			return "warning";
		case "blocked":
			return "error";
		case "completed":
			return "accent";
		default:
			return "dim";
	}
}

function planLabel(): string {
	return isPlanExecuting() ? "执行中" : isPlanModeActive() ? "规划中" : "off";
}

/** 控制台顶部状态区：模型 / 运行态 / 上下文，每次渲染都重新读取，切主题也会跟着变色。 */
function statusLines(ctx: ExtensionCommandContext, theme: Theme): string[] {
	const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
	const dot = sep(theme);
	const level = config.currentModel.thinking;
	const sessionModel = ctx.model ? modelIdOf(ctx.model) : undefined;
	const authed = ctx.model ? ctx.modelRegistry.hasConfiguredAuth(ctx.model) : false;
	const modelParts = [
		theme.fg("text", sessionModel ?? config.currentModel.model),
		theme.fg(thinkingTone(level), `thinking ${level}`),
		authed ? badge(theme, "已认证", "success") : badge(theme, "未认证", "warning"),
	];
	if (sessionModel && sessionModel !== config.currentModel.model) {
		modelParts.push(theme.fg("dim", `配置 ${shortModel(config.currentModel.model)}`));
	}
	const lines = [kv(theme, "◆", "模型", modelParts.join(dot))];

	const goal = getGoalState();
	const providers = collectProviderStatus(ctx, config);
	const plan = planLabel();
	lines.push(
		kv(
			theme,
			"◈",
			"运行",
			[
				`${theme.fg("dim", "Goal")} ${theme.fg(goalTone(goal.status), goal.status)}`,
				`${theme.fg("dim", "Plan")} ${theme.fg(plan === "off" ? "dim" : "warning", plan)}`,
				`${theme.fg("dim", "子代理并行")} ${theme.fg("text", String(config.subagents.maxConcurrency))}`,
				`${theme.fg("dim", "厂商")} ${theme.fg("text", `${providers.filter((p) => p.authenticated).length}/${providers.length}`)}`,
			].join(dot),
		),
	);

	const usage = ctx.getContextUsage();
	if (usage) {
		const pct = usage.percent ?? 0;
		const tone: ThemeColor = pct > 90 ? "error" : pct > 70 ? "warning" : "success";
		lines.push(
			kv(
				theme,
				"▤",
				"上下文",
				[
					`${gauge(theme, pct / 100, 12, tone)} ${theme.fg(tone, `${Math.round(pct)}%`)}`,
					theme.fg("muted", `${fmtTokens(usage.tokens ?? 0)} / ${fmtTokens(usage.contextWindow)}`),
				].join(dot),
			),
		);
	}
	return lines;
}

/**
 * 控制台的全部条目。`group` 就是 tab 名，tab 顺序按这里第一次出现的顺序排。
 *
 * 分组还兼顾条数：列表区的高度按「最多项的那一栏」固定，差得越多，
 * 项少的那一栏空行就越多。所以 advisor / 关键词 / 自动分工 从「工作流」里分出来
 * 单独一栏 —— 它们本来就是同一类（不用你开口，模型自己多做一步），
 * 拆完 2/5/4/3/3，最空的一栏也只补三行。
 */
function cockpitItems(ctx: ExtensionCommandContext, config: PiExtendsConfig): MenuItem[] {
	const goal = getGoalState();
	const providers = collectProviderStatus(ctx, config);
	const authedProviders = providers.filter((p) => p.authenticated).length;
	const customRoles = ROLE_NAMES.filter((r) => config.roles[r] !== undefined).length;
	const footerOn = footerController.isEnabled?.() ?? false;
	const tpsOn = footerController.isTpsEnabled?.() ?? false;
	const advisorOn = advisorController.isEnabled(config);
	const readyPlans = collectPlanStatus(ctx).filter((p) => p.authenticated).length;
	return [
		{
			id: "theme",
			group: "外观",
			icon: "◐",
			label: "主题",
			hotkey: "1",
			value: config.theme,
			hint: "移动光标即时预览",
		},
		{
			id: "footer",
			group: "外观",
			icon: "▤",
			label: "状态栏 Footer",
			hotkey: "2",
			value: footerOn ? "on" : "off",
			tone: footerOn ? undefined : "muted",
			hint: `cometix 单行 · TPS ${tpsOn ? "on" : "off"}`,
		},
		{
			id: "model",
			group: "模型",
			icon: "◆",
			label: "主模型",
			hotkey: "3",
			value: shortModel(config.currentModel.model),
			hint: `thinking ${config.currentModel.thinking}`,
		},
		{
			id: "roles",
			group: "模型",
			icon: "◇",
			label: "角色模型与权限",
			hotkey: "4",
			value: `${customRoles}/${ROLE_NAMES.length} 已定制`,
			hint: ROLE_NAMES.join(" · "),
		},
		{
			id: "routes",
			group: "模型",
			icon: "◈",
			label: "路由角色",
			hotkey: "r",
			value: `${customizedRouteCount(config)}/${ROUTE_NAMES.length} 已定制`,
			hint: "按用途分模型：smol · slow · plan · vision …",
		},
		{
			id: "plans",
			group: "模型",
			icon: "◉",
			label: "Coding Plan 与 API",
			hotkey: "5",
			value: readyPlans === 0 ? "未开通" : `${readyPlans} 家已开通`,
			tone: readyPlans === 0 ? "warning" : undefined,
			hint: "Claude · ChatGPT · Kimi · GLM · OpenCode · Qwen …",
			keywords: "login auth claude chatgpt kimi glm zai qwen copilot 认证 订阅",
		},
		{
			id: "providers",
			group: "模型",
			icon: "◈",
			label: "自定义厂商",
			hotkey: "p",
			value: `${authedProviders}/${providers.length} 已认证`,
			hint: `自定义 ${config.providers.length} 个 · OpenAI / Anthropic 兼容端点`,
		},
		{
			id: "subagents",
			group: "工作流",
			icon: "▶",
			label: "子代理",
			hotkey: "6",
			value: `并行 ${config.subagents.maxConcurrency}`,
			hint: "single · parallel · chain",
		},
		{
			id: "goal",
			group: "工作流",
			icon: "◉",
			label: "Goal 模式",
			hotkey: "7",
			value: goal.status,
			tone: goalTone(goal.status),
			hint: goal.text || `默认 ${config.goal.defaultMode} · 上限 ${config.goal.maxAutoTurns} 轮`,
		},
		{
			id: "plan",
			group: "工作流",
			icon: "▦",
			label: "Plan 模式",
			hotkey: "8",
			value: planLabel(),
			hint: "只读探索 → 逐步执行",
		},
		{
			id: "prompts",
			group: "工作流",
			icon: "▪",
			label: "工作流提示词",
			hotkey: "9",
			value: `${WORKFLOW_PROMPTS.length} 个`,
			hint: "填入编辑器或查看内容",
		},
		{
			id: "advisor",
			group: "自动化",
			icon: "▲",
			label: "Advisor 旁审",
			hotkey: "a",
			value: advisorOn ? "on" : "off",
			tone: advisorOn ? undefined : "muted",
			hint: `第二个模型每轮复查 · 阈值 ${config.advisor.minSeverity}`,
		},
		{
			id: "keywords",
			group: "自动化",
			icon: "✦",
			label: "魔法关键词",
			hotkey: "k",
			value: config.keywords.enabled ? "on" : "off",
			tone: config.keywords.enabled ? undefined : "muted",
			hint: MAGIC_KEYWORDS.join(" · "),
		},
		{
			id: "orchestration",
			group: "自动化",
			icon: "▨",
			label: "自动分工",
			hotkey: "d",
			value: config.orchestration.mode,
			tone: config.orchestration.mode === "off" ? "muted" : undefined,
			// 值列已经写着模式名了，说明文字就留给「它凭什么触发」——阈值是唯一需要调的旋钮。
			hint:
				config.orchestration.mode === "off"
					? "一条消息里有好几件事时提醒拆成并行子代理"
					: `一条消息 ≥ ${config.orchestration.minComplexity} 分就${config.orchestration.mode === "auto" ? "直接" : "问一句再"}拆成并行子代理`,
			keywords: "orchestration 分工 拆分 并行 子代理 复杂度",
		},
		{
			id: "status",
			group: "系统",
			icon: "▣",
			label: "状态总览",
			hotkey: "s",
			hint: "模型 / 角色 / 厂商 / 上下文一页看全",
		},
		{
			id: "config",
			group: "系统",
			icon: "○",
			label: "配置管理",
			hotkey: "c",
			hint: ".pi/pi-extends.json · 校验 / 重载 / 生成",
		},
		{
			// pi 自己的 /settings 归 pi core 管，扩展 API 既读不到也写不了，
			// 只能把命令填进输入框帮用户跳过去。详见 dispatch 里的说明。
			id: "pi-settings",
			group: "系统",
			icon: "⚙",
			label: "pi 原生设置",
			hotkey: "o",
			hint: "跳转 /settings · pi 自带的 34 项开关，不由本扩展管理",
			keywords: "settings 设置 原生",
		},
	];
}

export async function openCockpit(ctx: ExtensionCommandContext): Promise<void> {
	if (ctx.mode !== "tui") {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		ctx.ui.notify(dashboardLines(ctx, config).join("\n"), "info");
		return;
	}
	while (true) {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const picked = await runMenu(ctx, {
			title: "Pi Extends 控制台",
			titleRight: `${config.theme} · v${config.version}`,
			status: (theme) => statusLines(ctx, theme),
			items: cockpitItems(ctx, config),
			tabs: true,
			mouse: true,
			initialId: lastCockpitItem,
			// overlay 的高度是硬上限，超出的行会被静默丢掉（最先丢的就是底部提示行）。
			// 卡片固定占 12 行（标题 + 3 行状态 + 空行 + tab 条 + 空行 + 翻页 + 说明 + 提示），
			// 这里留 15 是给它一点余量，别正好卡在边界上。
			reserved: 15,
		});
		if (picked === undefined) {
			return;
		}
		lastCockpitItem = picked;
		const stay = await dispatch(ctx, picked);
		if (!stay) {
			return;
		}
	}
}

/** 返回 false 表示这一项处理完后直接关闭控制台（例如已把提示词填进编辑器）。 */
async function dispatch(ctx: ExtensionCommandContext, id: string): Promise<boolean> {
	switch (id) {
		case "theme":
			await themeWizard(ctx);
			return true;
		case "footer":
			await footerMenu(ctx);
			return true;
		case "model":
			await currentModelWizard(ctx);
			return true;
		case "roles":
			await roleMenu(ctx);
			return true;
		case "routes":
			await routesWizard(ctx);
			return true;
		case "advisor":
			await advisorMenu(ctx);
			return true;
		case "keywords":
			await keywordsMenu(ctx);
			return true;
		case "orchestration":
			await orchestrationMenu(ctx);
			return true;
		case "plans":
			return await openPlansPage(ctx);
		case "providers":
			await providersMenu(ctx);
			return true;
		case "subagents":
			return await subagentsMenu(ctx);
		case "goal":
			await goalMenu(ctx);
			return true;
		case "plan":
			await planMenu(ctx);
			return true;
		case "prompts":
			return await promptsMenu(ctx);
		case "status":
			await statusPage(ctx);
			return true;
		case "config":
			await configMenu(ctx);
			return true;
		case "pi-settings":
			// 不能把 /settings 并进来：那 34 项配置存在 ~/.pi/agent/settings.json，
			// pi 启动时读进内存、没有文件监听，扩展 API 也没有读写它的入口。
			// 从外面改文件是「最后写的赢」，pi 退出时会用内存里的值覆盖掉。
			// 所以这里只做跳转，不做镜像。
			ctx.ui.setEditorText("/settings");
			ctx.ui.notify("已填入 /settings，回车打开 pi 原生设置。", "info");
			return false;
		default:
			return true;
	}
}

export async function applyTheme(
	ctx: ExtensionCommandContext,
	name: string,
): Promise<boolean> {
	const result = ctx.ui.setTheme(name);
	if (!result.success) {
		ctx.ui.notify(`切换主题失败: ${result.error ?? "未知错误"}`, "error");
		return false;
	}
	await editConfig(
		ctx,
		(config) => {
			config.theme = name;
		},
		{ touched: ["theme"], notify: `主题已切换为 ${name}。` },
	);
	return true;
}

function themeNames(ctx: ExtensionCommandContext): string[] {
	const names = ctx.ui.getAllThemes().map((t) => t.name);
	return [...new Set(["dark", "light", ...names])].sort();
}

/** 主题色板预览：光标移动时 setTheme 立即生效，这几行会跟着换色。 */
function themePreview(theme: Theme): string[] {
	const tokens: ThemeColor[] = [
		"accent",
		"success",
		"warning",
		"error",
		"mdLink",
		"thinkingHigh",
		"muted",
		"dim",
	];
	const swatch = tokens.map((t) => theme.fg(t, "██")).join(" ");
	const sample = [
		theme.fg("mdHeading", "# 标题"),
		theme.fg("mdCode", "`code`"),
		theme.bg("selectedBg", theme.fg("text", " 选中行 ")),
		theme.fg("toolDiffAdded", "+ added"),
		theme.fg("toolDiffRemoved", "- removed"),
	].join("  ");
	return [kv(theme, "◐", "色板", swatch), kv(theme, "▤", "示例", sample)];
}

async function themeWizard(ctx: ExtensionCommandContext): Promise<void> {
	const original = getConfig(ctx.cwd, ctx.isProjectTrusted()).theme;
	const names = themeNames(ctx);
	const items: MenuItem[] = names.map((name, i) => ({
		id: name,
		icon: name === original ? "◉" : "○",
		label: name,
		hotkey: i < 9 ? String(i + 1) : undefined,
		hint: name === original ? "当前" : "",
	}));
	const picked = await runMenu(ctx, {
		title: "主题",
		titleRight: `${names.length} 个可用`,
		status: (theme) => themePreview(theme),
		items,
		initialId: original,
		onHighlight: (id) => {
			ctx.ui.setTheme(id);
		},
	});
	if (picked === undefined) {
		ctx.ui.setTheme(original);
		return;
	}
	await applyTheme(ctx, picked);
}

export async function pickTheme(ctx: ExtensionCommandContext): Promise<string | undefined> {
	if (ctx.mode !== "tui") {
		return ctx.ui.select("选择主题（Esc 返回）", themeNames(ctx), { timeout: 60000 });
	}
	const current = getConfig(ctx.cwd, ctx.isProjectTrusted()).theme;
	const items: MenuItem[] = themeNames(ctx).map((name, i) => ({
		id: name,
		icon: name === current ? "◉" : "○",
		label: name,
		hotkey: i < 9 ? String(i + 1) : undefined,
	}));
	const picked = await runMenu(ctx, {
		title: "主题",
		status: (theme) => themePreview(theme),
		items,
		initialId: current,
		onHighlight: (id) => {
			ctx.ui.setTheme(id);
		},
	});
	if (picked === undefined) {
		ctx.ui.setTheme(current);
	}
	return picked;
}

export async function runThemeCommand(
	ctx: ExtensionCommandContext,
	args: string,
): Promise<void> {
	const name = args.trim();
	if (name) {
		await applyTheme(ctx, name);
		return;
	}
	const picked = await pickTheme(ctx);
	if (picked !== undefined) {
		await applyTheme(ctx, picked);
	}
}

async function applyCurrentModel(ctx: ExtensionCommandContext, id: string): Promise<void> {
	const model = findModelById(ctx, id);
	if (model) {
		const ok = await getAPI().setModel(model);
		if (!ok) {
			ctx.ui.notify("切换模型失败：可能缺少 API Key。", "warning");
		}
	} else {
		ctx.ui.notify(`模型 ${id} 不在注册表中，仅写入配置。`, "warning");
	}
	await editConfig(
		ctx,
		(config) => {
			config.currentModel.model = id;
		},
		{ touched: ["currentModel"], notify: `主模型已设为 ${id}。` },
	);
}

async function currentModelWizard(ctx: ExtensionCommandContext): Promise<void> {
	while (true) {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const level = config.currentModel.thinking;
		const picked = await runMenu(ctx, {
			title: "主模型",
			titleRight: shortModel(config.currentModel.model),
			status: (theme) => statusLines(ctx, theme).slice(0, 1),
			items: [
				{
					id: "model",
					icon: "◆",
					label: "选择模型",
					hotkey: "1",
					value: shortModel(config.currentModel.model),
					hint: config.currentModel.model,
				},
				{
					id: "thinking",
					icon: "◈",
					label: "thinking level",
					hotkey: "2",
					value: level,
					tone: thinkingTone(level),
					hint: THINKING_HINTS[level],
				},
				{
					id: "sync",
					icon: "▸",
					label: "把配置里的模型应用到本次会话",
					hotkey: "3",
					hint: "会话模型与配置不一致时用",
				},
			],
		});
		if (picked === undefined) {
			return;
		}
		if (picked === "model") {
			const id = await pickModelId(ctx, "选择主模型", config.currentModel.model);
			if (id !== undefined) {
				await applyCurrentModel(ctx, id);
			}
		} else if (picked === "thinking") {
			const lvl = await pickThinking(ctx, "thinking level", level);
			if (lvl !== undefined && lvl !== "__inherit") {
				getAPI().setThinkingLevel(lvl);
				await editConfig(
					ctx,
					(c) => {
						c.currentModel.thinking = lvl;
					},
					{ touched: ["currentModel"], notify: `thinking 已设为 ${lvl}。` },
				);
			}
		} else if (picked === "sync") {
			await applyCurrentModel(ctx, config.currentModel.model);
		}
	}
}

const ROLE_META: Record<RoleName, { icon: string; hint: string }> = {
	scout: { icon: "◇", hint: "只读侦察：定位代码与事实" },
	planner: { icon: "◈", hint: "只读规划：产出实施步骤" },
	worker: { icon: "◆", hint: "读写执行：改代码、跑命令" },
	reviewer: { icon: "◉", hint: "只读复审：找缺陷与回归" },
};

export async function roleMenu(ctx: ExtensionCommandContext): Promise<void> {
	while (true) {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const items: MenuItem[] = ROLE_NAMES.map((role, i) => {
			const rc = config.roles[role];
			const custom = rc !== undefined && (rc.model || rc.thinking || rc.tools);
			return {
				id: role,
				icon: ROLE_META[role].icon,
				label: role,
				hotkey: String(i + 1),
				value: shortModel(resolveRoleModel(config, role)),
				tone: custom ? undefined : "muted",
				hint: `${resolveRoleThinking(config, role)} · ${resolveRoleTools(config, role).join(" ")}`,
			};
		});
		const picked = await runMenu(ctx, {
			title: "角色",
			titleRight: "四个子代理角色的模型 · thinking · 工具",
			status: (theme) =>
				ROLE_NAMES.map((role) =>
					kv(
						theme,
						ROLE_META[role].icon,
						role,
						theme.fg("dim", ROLE_META[role].hint),
					),
				),
			items,
			reserved: 16,
		});
		if (picked === undefined) {
			return;
		}
		await editRoleWizard(ctx, picked as RoleName);
	}
}

async function providersMenu(ctx: ExtensionCommandContext): Promise<void> {
	while (true) {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const providers = collectProviderStatus(ctx, config);
		const authed = providers.filter((p) => p.authenticated).length;
		const picked = await runMenu(ctx, {
			title: "厂商与认证",
			titleRight: `${authed}/${providers.length} 已认证`,
			status: (theme) =>
				providers.slice(0, 3).map((p) =>
					kv(
						theme,
						p.authenticated ? "◉" : "○",
						p.id,
						`${theme.fg(p.authenticated ? "success" : "muted", p.authenticated ? "已认证" : "未认证")}${sep(theme)}${theme.fg("dim", `${p.modelCount} 个模型`)}`,
					),
				),
			items: [
				{ id: "status", icon: "▣", label: "查看认证状态", hotkey: "1", value: `${providers.length} 个厂商` },
				{ id: "add", icon: "+", label: "添加自定义厂商", hotkey: "2", hint: "OpenAI 兼容 / Anthropic 兼容端点" },
				{
					id: "remove",
					icon: "-",
					label: "移除自定义厂商",
					hotkey: "3",
					value: `${config.providers.length} 个`,
					tone: config.providers.length === 0 ? "muted" : undefined,
				},
			],
		});
		if (picked === undefined) {
			return;
		}
		if (picked === "status") {
			await providerStatusPage(ctx);
		} else if (picked === "add") {
			await addProviderWizard(ctx);
		} else if (picked === "remove") {
			await removeProviderWizard(ctx);
		}
	}
}

async function askPositiveInt(
	ctx: ExtensionCommandContext,
	title: string,
	label: string,
	current: number,
	max: number,
): Promise<number | undefined> {
	const raw = await runPrompt(ctx, {
		title,
		titleRight: `当前 ${current}`,
		label: `${label}（1-${max}）`,
		initial: String(current),
	});
	if (raw === undefined) {
		return undefined;
	}
	const parsed = Number.parseInt(raw.trim(), 10);
	if (!Number.isFinite(parsed) || parsed < 1) {
		ctx.ui.notify("请输入不小于 1 的整数。", "warning");
		return undefined;
	}
	return Math.min(max, parsed);
}

/** 返回 false：已启动子代理，关闭控制台把终端让给子代理输出。 */
async function subagentsMenu(ctx: ExtensionCommandContext): Promise<boolean> {
	while (true) {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const limits = config.subagents;
		const picked = await runMenu(ctx, {
			title: "子代理",
			titleRight: `并行 ${limits.maxConcurrency} · 上限 ${limits.maxParallelTasks} 个任务`,
			status: (theme) => [
				kv(theme, "▶", "single", theme.fg("dim", "一个角色跑一个任务")),
				kv(theme, "▷", "parallel", theme.fg("dim", "多个任务同时跑，受并行数限制")),
				kv(theme, "▸", "chain", theme.fg("dim", "串行，用 {previous} 引用上一步结果")),
			],
			items: [
				{ id: "launch", icon: "▶", label: "启动子代理", hotkey: "1", hint: "single / parallel / chain 向导" },
				{
					id: "concurrency",
					icon: "◈",
					label: "最大并行数",
					hotkey: "2",
					value: String(limits.maxConcurrency),
					hint: "同时运行的子代理数量",
				},
				{
					id: "tasks",
					icon: "◇",
					label: "最大任务数",
					hotkey: "3",
					value: String(limits.maxParallelTasks),
					hint: "一次 parallel/chain 允许的任务条数",
				},
			],
		});
		if (picked === undefined) {
			return true;
		}
		if (picked === "launch") {
			await runSubagentLauncher(ctx, "");
			return false;
		}
		if (picked === "concurrency") {
			const n = await askPositiveInt(ctx, "最大并行数", "同时运行的子代理数量", limits.maxConcurrency, 16);
			if (n !== undefined) {
				await editConfig(
					ctx,
					(c) => {
						c.subagents.maxConcurrency = n;
					},
					{ touched: ["subagents"], notify: `最大并行数已设为 ${n}。` },
				);
			}
		} else if (picked === "tasks") {
			const n = await askPositiveInt(ctx, "最大任务数", "一次允许的任务条数", limits.maxParallelTasks, 32);
			if (n !== undefined) {
				await editConfig(
					ctx,
					(c) => {
						c.subagents.maxParallelTasks = n;
					},
					{ touched: ["subagents"], notify: `最大任务数已设为 ${n}。` },
				);
			}
		}
	}
}

async function goalMenu(ctx: ExtensionCommandContext): Promise<void> {
	while (true) {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const goal = getGoalState();
		const running = goal.status === "active";
		const items: MenuItem[] = [
			{
				id: "start",
				icon: "▶",
				label: "开始新目标",
				hotkey: "1",
				value: running ? "将覆盖当前目标" : "",
				hint: "focused：只在你发起的轮次里保持",
			},
			{
				id: "start-auto",
				icon: "▶",
				label: "开始新目标（autopilot）",
				hotkey: "2",
				hint: `每轮结束自动继续，上限 ${config.goal.maxAutoTurns} 轮`,
			},
			{ id: "pause", icon: "▮", label: "暂停", hotkey: "3", tone: running ? undefined : "muted" },
			{
				id: "resume",
				icon: "▷",
				label: "恢复",
				hotkey: "4",
				tone: goal.status === "paused" || goal.status === "blocked" ? undefined : "muted",
			},
			{ id: "complete", icon: "✓", label: "标记完成", hotkey: "5", hint: "附一句完成摘要" },
			{ id: "clear", icon: "×", label: "清除目标", hotkey: "6", tone: "muted" },
			{
				id: "turns",
				icon: "◈",
				label: "autopilot 轮次上限",
				hotkey: "7",
				value: String(config.goal.maxAutoTurns),
				hint: "达到上限自动暂停",
			},
		];
		const picked = await runMenu(ctx, {
			title: "Goal 模式",
			titleRight: `${goal.status} · ${goal.turnsUsed}/${goal.maxTurns} 轮`,
			status: (theme) => goalStatusLines(theme, goal),
			items,
			reserved: 16,
		});
		if (picked === undefined) {
			return;
		}
		await runGoalAction(ctx, picked);
	}
}

function goalStatusLines(theme: Theme, goal: ReturnType<typeof getGoalState>): string[] {
	const lines = [
		kv(
			theme,
			"◉",
			"目标",
			goal.text ? theme.fg("text", goal.text) : theme.fg("dim", "(未设置)"),
		),
		kv(
			theme,
			"◈",
			"状态",
			`${theme.fg(goalTone(goal.status), goal.status)}${sep(theme)}${theme.fg("dim", goal.strategy)}${sep(theme)}${gauge(theme, goal.maxTurns > 0 ? goal.turnsUsed / goal.maxTurns : 0, 10)} ${theme.fg("muted", `${goal.turnsUsed}/${goal.maxTurns}`)}`,
		),
	];
	if (goal.progress) {
		lines.push(kv(theme, "▸", "进度", theme.fg("muted", goal.progress)));
	}
	if (goal.blockedReason) {
		lines.push(kv(theme, "×", "阻塞", theme.fg("error", goal.blockedReason)));
	}
	if (goal.summary) {
		lines.push(kv(theme, "✓", "摘要", theme.fg("success", goal.summary)));
	}
	return lines;
}

async function runGoalAction(ctx: ExtensionCommandContext, action: string): Promise<void> {
	const api = getAPI();
	if (action === "start" || action === "start-auto") {
		const text = await runPrompt(ctx, {
			title: action === "start" ? "新目标（focused）" : "新目标（autopilot）",
			label: "一句话描述目标",
		});
		if (text === undefined || text.trim() === "") {
			return;
		}
		const suffix = action === "start-auto" ? " --autopilot" : "";
		await runGoalCommand(api, ctx, `start ${text.trim()}${suffix}`);
		return;
	}
	if (action === "complete") {
		const summary = await runPrompt(ctx, { title: "完成目标", label: "完成摘要" });
		if (summary === undefined) {
			return;
		}
		await runGoalCommand(api, ctx, `complete ${summary.trim()}`);
		return;
	}
	if (action === "turns") {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const n = await askPositiveInt(
			ctx,
			"autopilot 轮次上限",
			"最多自动推进多少轮",
			config.goal.maxAutoTurns,
			50,
		);
		if (n !== undefined) {
			await editConfig(
				ctx,
				(c) => {
					c.goal.maxAutoTurns = n;
				},
				{ touched: ["goal"], notify: `autopilot 轮次上限已设为 ${n}。` },
			);
		}
		return;
	}
	if (action === "pause" || action === "resume" || action === "clear") {
		await runGoalCommand(api, ctx, action);
	}
}

async function planMenu(ctx: ExtensionCommandContext): Promise<void> {
	while (true) {
		const active = isPlanModeActive();
		const executing = isPlanExecuting();
		const picked = await runMenu(ctx, {
			title: "Plan 模式",
			titleRight: planLabel(),
			status: (theme) => [
				kv(
					theme,
					"▦",
					"当前",
					executing
						? theme.fg("accent", "执行中：按步骤推进，完成一步打 [DONE:n]")
						: active
							? theme.fg("warning", "规划中：edit/write 已禁用，bash 仅白名单")
							: theme.fg("dim", "未启用：完整权限"),
				),
				kv(theme, "▸", "快捷键", theme.fg("muted", "Ctrl+Alt+P 直接开关；/todos 查看步骤")),
			],
			items: [
				{
					id: "on",
					icon: "▶",
					label: "进入 Plan 模式",
					hotkey: "1",
					tone: active ? "muted" : undefined,
					hint: "只读探索，产出编号计划",
				},
				{
					id: "off",
					icon: "▮",
					label: "退出 Plan 模式",
					hotkey: "2",
					tone: active ? undefined : "muted",
					hint: "恢复完整工具权限",
				},
				{ id: "status", icon: "▣", label: "查看计划状态", hotkey: "3" },
				{
					id: "execute",
					icon: "▷",
					label: "开始执行计划",
					hotkey: "4",
					hint: "逐步执行并跟踪进度",
				},
			],
		});
		if (picked === undefined) {
			return;
		}
		if (picked === "on") {
			planController.enable?.(ctx);
		} else if (picked === "off") {
			planController.disable?.(ctx);
		} else if (picked === "status") {
			planController.status?.(ctx);
		} else if (picked === "execute") {
			planController.execute?.(ctx);
			return;
		}
	}
}

async function footerMenu(ctx: ExtensionCommandContext): Promise<void> {
	while (true) {
		const on = footerController.isEnabled?.() ?? false;
		const tps = footerController.isTpsEnabled?.() ?? false;
		const picked = await runMenu(ctx, {
			title: "状态栏 Footer",
			titleRight: on ? "on" : "off",
			status: (theme) => [
				kv(
					theme,
					"▤",
					"内容",
					theme.fg("muted", "模型+thinking · 目录 · Git · 上下文 · token · 费用 · 时长"),
				),
				kv(
					theme,
					"◈",
					"状态",
					`${theme.fg(on ? "success" : "dim", on ? "已启用" : "已关闭")}${sep(theme)}${theme.fg(tps ? "success" : "dim", `TPS ${tps ? "on" : "off"}`)}`,
				),
			],
			items: [
				{
					id: "toggle",
					icon: "◐",
					label: on ? "关闭 cometix footer" : "启用 cometix footer",
					hotkey: "1",
					value: on ? "on" : "off",
				},
				{
					id: "tps",
					icon: "◈",
					label: tps ? "隐藏 TPS" : "显示 TPS",
					hotkey: "2",
					value: tps ? "on" : "off",
					hint: "每秒输出 token 数",
				},
			],
		});
		if (picked === undefined) {
			return;
		}
		if (picked === "toggle") {
			footerController.setEnabled?.(ctx, !on);
			ctx.ui.notify(`Cometix footer ${!on ? "on" : "off"}。`, "info");
		} else if (picked === "tps") {
			footerController.setTps?.(!tps);
			ctx.ui.notify(`Footer TPS ${!tps ? "on" : "off"}。`, "info");
		}
	}
}

/** Advisor 旁审：开关、严重程度阈值、单会话上限。 */
export async function openAdvisorMenu(ctx: ExtensionCommandContext): Promise<void> {
	const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
	if (ctx.mode !== "tui") {
		ctx.ui.notify(
			`Advisor ${advisorController.isEnabled(config) ? "on" : "off"} · 阈值 ${config.advisor.minSeverity} · 上限 ${config.advisor.maxPerSession}`,
			"info",
		);
		return;
	}
	await advisorMenu(ctx);
}

async function advisorMenu(ctx: ExtensionCommandContext): Promise<void> {
	while (true) {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const on = advisorController.isEnabled(config);
		const picked = await runMenu(ctx, {
			title: "Advisor 旁审",
			titleRight: on ? "on" : "off",
			status: (theme) => [
				kv(
					theme,
					"▲",
					"作用",
					theme.fg("muted", "每轮结束后由第二个模型只读复查，产出 旁注/疑虑/阻塞 卡片"),
				),
				kv(
					theme,
					"◆",
					"模型",
					theme.fg("text", resolveRoute(config, "advisor").model) +
						theme.fg("dim", "  ← 路由 advisor"),
				),
				kv(
					theme,
					"◈",
					"状态",
					`${theme.fg(on ? "success" : "dim", on ? "已启用" : "已关闭")}${sep(theme)}${theme.fg("dim", `阈值 ${config.advisor.minSeverity} · 本会话已出 ${advisorController.shown()} 条 / 上限 ${config.advisor.maxPerSession}`)}`,
				),
			],
			items: [
				{
					id: "toggle",
					group: "开关",
					icon: "◐",
					label: on ? "关闭旁审" : "启用旁审",
					hotkey: "1",
					value: on ? "on" : "off",
					hint: on ? "关掉后不再拉起旁审子进程" : "每轮会额外跑一次模型，有额外费用",
				},
				...ADVISOR_SEVERITIES.map((s, i) => ({
					id: `sev-${s}`,
					group: "最低展示等级",
					icon: config.advisor.minSeverity === s ? "◉" : "○",
					label: s,
					hotkey: String(i + 2),
					tone: (s === "blocker" ? "error" : s === "concern" ? "warning" : "dim") as ThemeColor,
					hint:
						s === "aside"
							? "全都展示，包括顺便一提"
							: s === "concern"
								? "只看值得处理的与阻塞的"
								: "只看会出问题的",
				})),
			],
			reserved: 16,
		});
		if (picked === undefined) {
			return;
		}
		if (picked === "toggle") {
			await setAdvisorEnabled(ctx, !on);
			ctx.ui.notify(`Advisor 旁审 ${!on ? "on" : "off"}。`, "info");
			continue;
		}
		if (picked.startsWith("sev-")) {
			const level = picked.slice(4) as AdvisorSeverity;
			await setAdvisorSeverity(ctx, level);
			ctx.ui.notify(`Advisor 最低展示等级已设为 ${level}。`, "info");
		}
	}
}

/** 魔法关键词：只有总开关，逐条说明写在 hint 里。 */
async function keywordsMenu(ctx: ExtensionCommandContext): Promise<void> {
	while (true) {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const on = config.keywords.enabled;
		const picked = await runMenu(ctx, {
			title: "魔法关键词",
			titleRight: on ? "on" : "off",
			status: (theme) => [
				kv(
					theme,
					"✦",
					"规则",
					theme.fg("muted", "只在散文里生效：代码块、行内代码、标签、路径与标识符中的同名词不触发"),
				),
			],
			items: [
				{
					id: "toggle",
					group: "开关",
					icon: "◐",
					label: on ? "关闭关键词" : "启用关键词",
					hotkey: "1",
					value: on ? "on" : "off",
				},
				...MAGIC_KEYWORDS.map((kw, i) => ({
					id: `kw-${kw}`,
					group: "关键词",
					icon: "✦",
					label: kw,
					hotkey: String(i + 2),
					hint: KEYWORD_HINTS[kw],
					tone: on ? undefined : ("muted" as ThemeColor),
				})),
			],
			reserved: 16,
		});
		if (picked === undefined) {
			return;
		}
		if (picked === "toggle") {
			await editConfig(
				ctx,
				(cfg) => {
					cfg.keywords.enabled = !on;
				},
				{ touched: ["keywords"], notify: `魔法关键词 ${!on ? "on" : "off"}。` },
			);
		}
	}
}

/** 三种模式的一句话解释，菜单和状态区共用，免得两边写得不一样。 */
const ORCHESTRATION_MODE_HINTS: Record<OrchestrationMode, string> = {
	off: "不看不问，只有你自己写 orchestrate 才拆",
	suggest: "先弹一句问你，答「否」则本会话不再问",
	auto: "直接追加 orchestrate 指令，只发一条通知",
};

/**
 * 自动分工：模式 + 阈值。
 *
 * 阈值单独列一项而不是塞进模式说明里 —— 会来关掉这个功能的人，一半其实只是嫌它太敏感。
 */
async function orchestrationMenu(ctx: ExtensionCommandContext): Promise<void> {
	while (true) {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const { mode, minComplexity } = config.orchestration;
		const picked = await runMenu(ctx, {
			title: "自动分工",
			titleRight: mode,
			status: (theme) => [
				kv(
					theme,
					"▨",
					"作用",
					theme.fg("muted", "看出一条消息其实是好几件事时，让它先派 scout 分头调查、汇总后再派 worker"),
				),
				kv(
					theme,
					"◈",
					"打分",
					theme.fg("dim", "待办条数 / 先后顺序 / 覆盖面词 / 点名文件数 / 篇幅，只数散文，代码块不算"),
				),
				kv(
					theme,
					"◐",
					"当前",
					`${theme.fg(mode === "off" ? "dim" : "success", ORCHESTRATION_MODE_HINTS[mode])}${sep(theme)}${theme.fg("dim", `阈值 ${minComplexity} 分`)}`,
				),
			],
			items: [
				...ORCHESTRATION_MODES.map((m, i) => ({
					id: `mode-${m}`,
					group: "触发方式",
					icon: mode === m ? "◉" : "○",
					label: m,
					hotkey: String(i + 1),
					tone: (m === "off" ? "dim" : m === "auto" ? "warning" : undefined) as ThemeColor | undefined,
					hint: ORCHESTRATION_MODE_HINTS[m],
				})),
				{
					id: "threshold",
					group: "阈值",
					icon: "▤",
					label: "最低复杂度",
					hotkey: "4",
					value: `${minComplexity} 分`,
					tone: mode === "off" ? ("muted" as ThemeColor) : undefined,
					// 具体数字来自 orchestration.ts 的权重表：列 5 条待办自己就值 3 分。
					hint: "调高更难触发。3 分约等于「列了三条待办」或「覆盖面 + 多文件」",
				},
			],
			reserved: 16,
		});
		if (picked === undefined) {
			return;
		}
		if (picked.startsWith("mode-")) {
			const next = picked.slice(5) as OrchestrationMode;
			await editConfig(
				ctx,
				(cfg) => {
					cfg.orchestration.mode = next;
				},
				{ touched: ["orchestration"], notify: `自动分工已设为 ${next}。` },
			);
			continue;
		}
		if (picked === "threshold") {
			const value = await askPositiveInt(ctx, "自动分工阈值", "最低复杂度分数", minComplexity, 8);
			if (value !== undefined) {
				await editConfig(
					ctx,
					(cfg) => {
						cfg.orchestration.minComplexity = value;
					},
					{ touched: ["orchestration"], notify: `自动分工阈值已设为 ${value} 分。` },
				);
			}
		}
	}
}

function readPrompt(id: string): string[] {
	try {
		return fs.readFileSync(path.join(PROMPTS_DIR, `${id}.md`), "utf8").split("\n");
	} catch {
		return [`(读取 ${id}.md 失败)`];
	}
}

/** 返回 false：已把提示词填进编辑器，关掉控制台让用户直接补任务描述。 */
async function promptsMenu(ctx: ExtensionCommandContext): Promise<boolean> {
	while (true) {
		const picked = await runMenu(ctx, {
			title: "工作流提示词",
			titleRight: "package.json 的 pi.prompts 注册为斜杠命令",
			status: (theme) => [
				kv(theme, "▪", "用法", theme.fg("muted", "选中后填入编辑器，补上任务描述再回车")),
			],
			items: WORKFLOW_PROMPTS.map((p, i) => ({
				id: p.id,
				icon: "▪",
				label: `/${p.id}`,
				hotkey: String(i + 1),
				hint: p.hint,
			})),
		});
		if (picked === undefined) {
			return true;
		}
		const action = await runMenu(ctx, {
			title: `/${picked}`,
			items: [
				{ id: "insert", icon: "▸", label: "填入编辑器", hotkey: "1", hint: `/${picked} ` },
				{ id: "view", icon: "▣", label: "查看提示词内容", hotkey: "2" },
			],
		});
		if (action === "insert") {
			ctx.ui.setEditorText(`/${picked} `);
			ctx.ui.notify(`已填入 /${picked}，补上任务描述后回车。`, "info");
			return false;
		}
		if (action === "view") {
			await runInfoPage(ctx, {
				title: `/${picked}`,
				titleRight: `${picked}.md`,
				lines: readPrompt(picked),
			});
		}
	}
}

async function configMenu(ctx: ExtensionCommandContext): Promise<void> {
	const { resolveConfigPaths } = await import("./config.ts");
	while (true) {
		const paths = resolveConfigPaths(ctx.cwd);
		const trusted = ctx.isProjectTrusted();
		const picked = await runMenu(ctx, {
			title: "配置管理",
			titleRight: trusted ? "项目已信任" : "项目未信任（仅读用户配置）",
			status: (theme) => [
				kv(theme, "▣", "项目", theme.fg("text", paths.projectPath)),
				kv(theme, "○", "用户", theme.fg("muted", paths.userPath)),
				kv(
					theme,
					"◈",
					"信任",
					trusted
						? theme.fg("success", "项目配置生效，写入项目文件")
						: theme.fg("warning", "项目配置被忽略，/trust 后生效"),
				),
			],
			items: [
				{ id: "validate", icon: "✓", label: "校验配置", hotkey: "1", hint: "重新解析并列出警告" },
				{ id: "reload", icon: "▷", label: "重新加载配置", hotkey: "2", hint: "手改 json 后同步进来" },
				{ id: "view", icon: "▣", label: "查看当前配置", hotkey: "3", hint: "已合并用户配置与项目配置" },
				{
					id: "generate",
					icon: "+",
					label: "写入示例配置",
					hotkey: "4",
					hint: "覆盖 .pi/pi-extends.json",
				},
			],
		});
		if (picked === undefined) {
			return;
		}
		await runConfigAction(ctx, picked);
	}
}

async function runConfigAction(ctx: ExtensionCommandContext, action: string): Promise<void> {
	const { atomicWriteJson, resolveConfigPaths } = await import("./config.ts");
	const paths = resolveConfigPaths(ctx.cwd);
	if (action === "validate" || action === "reload") {
		const result = reload(ctx.cwd, ctx.isProjectTrusted());
		const ok = result.warnings.length === 0;
		const verb = action === "validate" ? "配置有效" : "配置已重新加载";
		ctx.ui.notify(
			ok ? `${verb}。` : `${verb}，但有 ${result.warnings.length} 条警告：${result.warnings.slice(0, 3).join("；")}`,
			ok ? "info" : "warning",
		);
		return;
	}
	if (action === "view") {
		const { config, warnings } = reload(ctx.cwd, ctx.isProjectTrusted());
		const lines = JSON.stringify(config, null, 2).split("\n");
		if (warnings.length > 0) {
			lines.push("", `警告 ${warnings.length} 条：`, ...warnings.map((w) => `- ${w}`));
		}
		await runInfoPage(ctx, {
			title: "当前配置",
			titleRight: paths.projectPath,
			lines,
		});
		return;
	}
	if (action === "generate") {
		const confirmed = await ctx.ui.confirm(
			"写入示例配置",
			`将覆盖 ${paths.projectPath}，当前项目配置会丢失。继续？`,
		);
		if (!confirmed) {
			return;
		}
		const { EXAMPLE_PATH } = await import("./index.ts");
		const example = JSON.parse(fs.readFileSync(EXAMPLE_PATH, "utf8"));
		await atomicWriteJson(paths.projectPath, example);
		reload(ctx.cwd, ctx.isProjectTrusted());
		ctx.ui.notify(`示例配置已写入 ${paths.projectPath}。`, "info");
	}
}

/** 纯文本状态摘要，非 TUI 模式（rpc/print）也能用。 */
export function dashboardLines(
	ctx: ExtensionCommandContext,
	config: PiExtendsConfig,
): string[] {
	const goal = getGoalState();
	const providers = collectProviderStatus(ctx, config);
	const usage = ctx.getContextUsage();
	const lines = [
		`主题: ${config.theme}`,
		`主模型: ${config.currentModel.model} · thinking ${config.currentModel.thinking}`,
		...ROLE_NAMES.map((r) => describeRole(config, r)),
		`Goal: ${goal.status} · ${goal.strategy} · ${goal.turnsUsed}/${goal.maxTurns} 轮${goal.text ? ` · ${goal.text}` : ""}`,
		`Plan: ${planLabel()}`,
		`子代理: 并行 ${config.subagents.maxConcurrency} · 任务上限 ${config.subagents.maxParallelTasks}`,
		`厂商: ${providers.filter((p) => p.authenticated).length}/${providers.length} 已认证 · 自定义 ${config.providers.length} 个`,
		`路由: ${customizedRouteCount(config)}/${ROUTE_NAMES.length} 已定制`,
		describeRoutes(config),
		`Advisor: ${advisorController.isEnabled(config) ? "on" : "off"} · 阈值 ${config.advisor.minSeverity} · 上限 ${config.advisor.maxPerSession}`,
		`魔法关键词: ${config.keywords.enabled ? "on" : "off"} · ${MAGIC_KEYWORDS.join(" ")}`,
	];
	if (usage) {
		lines.push(
			`上下文: ${fmtTokens(usage.tokens ?? 0)}/${fmtTokens(usage.contextWindow)}（${Math.round(usage.percent ?? 0)}%）`,
		);
	}
	return lines;
}

/** 一页看全的状态总览：模型、角色、运行态、厂商、路径。 */
async function statusPage(ctx: ExtensionCommandContext): Promise<void> {
	const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
	const theme = ctx.ui.theme;
	const { resolveConfigPaths } = await import("./config.ts");
	const paths = resolveConfigPaths(ctx.cwd);
	const goal = getGoalState();
	const providers = collectProviderStatus(ctx, config);
	const dim = (s: string) => theme.fg("dim", s);
	const lines: string[] = [
		theme.fg("accent", "模型"),
		...statusLines(ctx, theme),
		"",
		theme.fg("accent", "角色"),
		...ROLE_NAMES.map((role) =>
			kv(
				theme,
				ROLE_META[role].icon,
				role,
				`${theme.fg("text", resolveRoleModel(config, role))}${dim("  ·  ")}${theme.fg(thinkingTone(resolveRoleThinking(config, role)), resolveRoleThinking(config, role))}${dim("  ·  ")}${theme.fg("muted", resolveRoleTools(config, role).join(" "))}`,
			),
		),
		"",
		theme.fg("accent", "路由"),
		...ROUTE_NAMES.map((route) => {
			const resolved = resolveRoute(config, route);
			const from =
				resolved.route === route
					? ""
					: dim(resolved.route === null ? "  ← 主模型" : `  ← ${resolved.route}`);
			return kv(
				theme,
				config.routes[route]?.model !== undefined ? "◉" : "○",
				route,
				`${theme.fg("text", shortModel(resolved.model))}${from}${dim("  ·  ")}${theme.fg(thinkingTone(resolved.thinking), resolved.thinking)}`,
			);
		}),
		"",
		theme.fg("accent", "运行"),
		kv(theme, "◉", "Goal", `${theme.fg(goalTone(goal.status), goal.status)}${dim("  ·  ")}${theme.fg("muted", goal.text || "(未设置)")}`),
		kv(theme, "▦", "Plan", theme.fg(planLabel() === "off" ? "dim" : "warning", planLabel())),
		kv(theme, "▶", "子代理", theme.fg("muted", `并行 ${config.subagents.maxConcurrency} · 任务上限 ${config.subagents.maxParallelTasks}`)),
		kv(theme, "▤", "Footer", theme.fg("muted", `${footerController.isEnabled?.() ? "on" : "off"} · TPS ${footerController.isTpsEnabled?.() ? "on" : "off"}`)),
		kv(
			theme,
			"▲",
			"Advisor",
			`${theme.fg(advisorController.isEnabled(config) ? "success" : "dim", advisorController.isEnabled(config) ? "on" : "off")}${dim("  ·  ")}${theme.fg("muted", `阈值 ${config.advisor.minSeverity} · 已出 ${advisorController.shown()}/${config.advisor.maxPerSession}`)}`,
		),
		kv(
			theme,
			"✦",
			"关键词",
			`${theme.fg(config.keywords.enabled ? "success" : "dim", config.keywords.enabled ? "on" : "off")}${dim("  ·  ")}${theme.fg("muted", MAGIC_KEYWORDS.join(" · "))}`,
		),
		"",
		theme.fg("accent", "厂商"),
		...providers.map((p) =>
			kv(
				theme,
				p.authenticated ? "◉" : "○",
				p.id,
				`${theme.fg(p.authenticated ? "success" : "muted", p.authenticated ? "已认证" : "未认证")}${dim("  ·  ")}${theme.fg("muted", `${p.modelCount} 个模型`)}${p.custom ? dim("  ·  自定义") : ""}`,
			),
		),
		"",
		theme.fg("accent", "路径"),
		kv(theme, "▣", "项目", theme.fg("muted", paths.projectPath)),
		kv(theme, "○", "用户", theme.fg("muted", paths.userPath)),
	];
	await runInfoPage(ctx, {
		title: "状态总览",
		titleRight: `${config.theme} · v${config.version}`,
		lines,
	});
}

export async function showDashboard(ctx: ExtensionCommandContext): Promise<void> {
	if (ctx.mode === "tui") {
		await statusPage(ctx);
		return;
	}
	const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
	ctx.ui.notify(dashboardLines(ctx, config).join("\n"), "info");
}
