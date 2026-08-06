/**
 * 用真实主题把控制台卡片渲染到终端，肉眼检查排版。测试断言得下的对齐、
 * 高度、颜色可见性，最后还是得看一眼才知道好不好看。
 *
 *   node --experimental-strip-types tools/preview-cockpit.ts [主题] [宽度] [切栏次数]
 *   node --experimental-strip-types tools/preview-cockpit.ts pi-paper 62 3
 *
 * 主题得从 pi 包内部路径拿：`loadThemeFromPath` 不在 exports 表里，
 * 只能用 import.meta.resolve 绕过去。它返回的已经是 Theme 实例（颜色是 Map），
 * 不要再 `new Theme(...)` 包一层。
 */
import { Card, MenuList, kv, gauge, badge, renderHints, setBorderStyle } from "../extensions/pi-extends/ui-kit.ts";
import { ICON_NAMES, ICON_SETS, icon, iconIn, setIconSet, resolveIconSet } from "../extensions/pi-extends/icons.ts";

const base = import.meta.resolve("@earendil-works/pi-coding-agent");
const mod: any = await import(base.replace(/index\.js$/, "modes/interactive/theme/theme.js"));

export function realTheme(name: string): any {
	return mod.loadThemeFromPath(`./themes/${name}.json`);
}

export function fakeTui(): any {
	return { terminal: { rows: 40, columns: 100 }, requestRender: () => {} };
}
export function fakeKeys(): any {
	return { matches: () => false };
}

export function cockpitCard(theme: any, tabs = true): Card {
	const items = [
		{ id: "theme", group: "外观", icon: icon("theme"), label: "主题", hotkey: "1", value: "pi-carbon", hint: "移动光标即时预览" },
		{ id: "icons", group: "外观", icon: icon("keywords"), label: "图标集", hotkey: "i", value: "lucide", hint: "lucide · nerd · unicode · ascii，四套并排预览" },
		{ id: "footer", group: "外观", icon: icon("footer"), label: "状态栏 Footer", hotkey: "2", value: "on", hint: "cometix 单行 · TPS on" },
		{ id: "model", group: "模型", icon: icon("model"), label: "主模型", hotkey: "3", value: "claude-sonnet-4-5", hint: "thinking high" },
		{ id: "roles", group: "模型", icon: icon("roles"), label: "角色模型与权限", hotkey: "4", value: "0/4 已定制", hint: "scout · planner · worker · reviewer" },
		{ id: "routes", group: "模型", icon: icon("routes"), label: "路由角色", hotkey: "r", value: "0/10 已定制", hint: "按用途给模型分工" },
		{ id: "plans", group: "模型", icon: icon("plans"), label: "Coding Plan 与 API", hotkey: "5", value: "未开通", tone: "warning", hint: "Claude · ChatGPT · Kimi · GLM · OpenCode · Qwen …" },
		{ id: "providers", group: "模型", icon: icon("providers"), label: "自定义厂商", hotkey: "p", value: "0 个", hint: "OpenAI / Anthropic 兼容端点" },
		{ id: "subagents", group: "工作流", icon: icon("subagents"), label: "子代理", hotkey: "6", value: "并行 4", hint: "single / parallel / chain" },
		{ id: "goal", group: "工作流", icon: icon("goal"), label: "Goal 模式", hotkey: "7", value: "off", tone: "muted", hint: "focused / autopilot" },
		{ id: "plan", group: "工作流", icon: icon("planMode"), label: "Plan 模式", hotkey: "8", value: "off", tone: "muted", hint: "只读探索 → 逐步执行" },
		{ id: "prompts", group: "工作流", icon: icon("prompts"), label: "工作流提示词", hotkey: "9", value: "3 个", hint: "填入编辑器或查看内容" },
		{ id: "advisor", group: "自动化", icon: icon("advisor"), label: "Advisor 旁审", hotkey: "a", value: "off", tone: "muted", hint: "第二个模型每轮复查 · 阈值 concern" },
		{ id: "keywords", group: "自动化", icon: icon("keywords"), label: "魔法关键词", hotkey: "k", value: "on", hint: "ultrathink · orchestrate · workflowz" },
		{ id: "orchestration", group: "自动化", icon: icon("orchestration"), label: "自动分工", hotkey: "d", value: "suggest", hint: "一条消息 ≥ 3 分就问一句再拆成并行子代理" },
		{ id: "status", group: "系统", icon: icon("status"), label: "状态总览", hotkey: "s", hint: "模型 / 角色 / 厂商 / 上下文一页看全" },
		{ id: "config", group: "系统", icon: icon("config"), label: "配置文件", hotkey: "c", value: ".pi/pi-extends.json", hint: "校验 / 重载 / 查看" },
		{ id: "pi-settings", group: "系统", icon: icon("settings"), label: "pi 原生设置", hotkey: "o", hint: "跳转 /settings · pi 自带的 34 项开关" },
	];
	const body = new MenuList(theme, fakeTui(), fakeKeys(), {
		items,
		maxVisible: 14,
		onSelect: () => {},
		onCancel: () => {},
		tabs,
		search: "hotkey",
	});
	return new Card(theme, {
		title: "Pi Extends 控制台",
		titleRight: "pi-carbon · v1",
		status: () => [
			kv(theme, icon("model"), "模型", `claude-sonnet-4-5  ·  thinking high  ·  ${badge(theme, "已认证")}`),
			kv(theme, icon("status"), "运行", "Goal off  ·  Plan off  ·  子代理并行 4  ·  厂商 0/38"),
			kv(theme, icon("ctx"), "上下文", `${gauge(theme, 0.42, 12)} 42%  ·  38k / 200k`),
		],
		hints: () => [
			{ key: "↑↓", label: "移动" },
			{ key: "⇥", label: "切栏" },
			{ key: "/", label: "搜索" },
			{ key: "⏎", label: "选择" },
			{ key: "esc", label: "返回" },
		],
		body,
	});
}

/**
 * 把全表按四套字形并排打出来，用于肉眼确认「装了字体的机器上到底长什么样」。
 *
 *   node --experimental-strip-types tools/preview-cockpit.ts --icons
 *
 * lucide 那一列在没装 lucide.ttf 的终端上会是豆腐块 —— 这正是它该有的样子，
 * 也正是控制台图标集页要让用户看到的东西。
 */
function printIconTable(): void {
	const w = Math.max(...ICON_NAMES.map((n) => n.length)) + 2;
	console.log(`\n### 图标全表 · ${ICON_NAMES.length} 个 × ${ICON_SETS.length} 套\n`);
	console.log(`  ${"name".padEnd(w)}${ICON_SETS.map((s) => s.padEnd(9)).join("")}`);
	console.log(`  ${"-".repeat(w + 9 * ICON_SETS.length)}`);
	for (const name of ICON_NAMES) {
		const cells = ICON_SETS.map((s) => `${iconIn(s, name)}        `.slice(0, 9)).join("");
		console.log(`  ${name.padEnd(w)}${cells}`);
	}
	console.log();
}

if (process.argv[2] === "--icons") {
	printIconTable();
	process.exit(0);
}

const which = process.argv[2] ?? "pi-carbon";
const width = Number(process.argv[3] ?? 96);
const tabHops = Number(process.argv[4] ?? 0);
// 第 5 个参数可以指定图标集，用来对比同一张卡在四套字形下的排版。
const iconSet = resolveIconSet(process.argv[5]);
if (iconSet) {
	setIconSet(iconSet);
}
// 第 6 个参数指定边框样式，用来对比同一张卡开框和不开框的排版。
if (process.argv[6]) {
	setBorderStyle(process.argv[6]);
}
const theme = realTheme(which);
const card = cockpitCard(theme);
const body: any = (card as any).opts?.body ?? (card as any).body;
for (let i = 0; i < tabHops; i++) {
	body.handleInput("\t");
}
const lines = card.render(width);
console.log(`\n### ${which} @ ${width} · tab+${tabHops} · ${lines.length} 行\n`);
for (const line of lines) {
	console.log(line);
}
console.log();
