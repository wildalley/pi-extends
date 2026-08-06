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
import { Card, MenuList, kv, gauge, badge, renderHints } from "../extensions/pi-extends/ui-kit.ts";

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
		{ id: "theme", group: "外观", icon: "◐", label: "主题", hotkey: "1", value: "pi-carbon", hint: "移动光标即时预览" },
		{ id: "footer", group: "外观", icon: "▤", label: "状态栏 Footer", hotkey: "2", value: "on", hint: "cometix 单行 · TPS on" },
		{ id: "model", group: "模型", icon: "◆", label: "主模型", hotkey: "3", value: "claude-sonnet-4-5", hint: "thinking high" },
		{ id: "roles", group: "模型", icon: "◇", label: "角色模型与权限", hotkey: "4", value: "0/4 已定制", hint: "scout · planner · worker · reviewer" },
		{ id: "routes", group: "模型", icon: "◈", label: "路由角色", hotkey: "r", value: "0/10 已定制", hint: "按用途给模型分工" },
		{ id: "plans", group: "模型", icon: "◉", label: "Coding Plan 与 API", hotkey: "5", value: "未开通", tone: "warning", hint: "Claude · ChatGPT · Kimi · GLM · OpenCode · Qwen …" },
		{ id: "providers", group: "模型", icon: "◈", label: "自定义厂商", hotkey: "p", value: "0 个", hint: "OpenAI / Anthropic 兼容端点" },
		{ id: "subagents", group: "工作流", icon: "▶", label: "子代理", hotkey: "6", value: "并行 4", hint: "single / parallel / chain" },
		{ id: "goal", group: "工作流", icon: "◉", label: "Goal 模式", hotkey: "7", value: "off", tone: "muted", hint: "focused / autopilot" },
		{ id: "plan", group: "工作流", icon: "▦", label: "Plan 模式", hotkey: "8", value: "off", tone: "muted", hint: "只读探索 → 逐步执行" },
		{ id: "prompts", group: "工作流", icon: "▪", label: "工作流提示词", hotkey: "9", value: "3 个", hint: "填入编辑器或查看内容" },
		{ id: "advisor", group: "自动化", icon: "▲", label: "Advisor 旁审", hotkey: "a", value: "off", tone: "muted", hint: "第二个模型每轮复查 · 阈值 concern" },
		{ id: "keywords", group: "自动化", icon: "✦", label: "魔法关键词", hotkey: "k", value: "on", hint: "ultrathink · orchestrate · workflowz" },
		{ id: "orchestration", group: "自动化", icon: "▨", label: "自动分工", hotkey: "d", value: "suggest", hint: "一条消息 ≥ 3 分就问一句再拆成并行子代理" },
		{ id: "status", group: "系统", icon: "▣", label: "状态总览", hotkey: "s", hint: "模型 / 角色 / 厂商 / 上下文一页看全" },
		{ id: "config", group: "系统", icon: "○", label: "配置文件", hotkey: "c", value: ".pi/pi-extends.json", hint: "校验 / 重载 / 查看" },
		{ id: "pi-settings", group: "系统", icon: "⚙", label: "pi 原生设置", hotkey: "o", hint: "跳转 /settings · pi 自带的 34 项开关" },
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
			kv(theme, "◆", "模型", `claude-sonnet-4-5  ·  thinking high  ·  ${badge(theme, "已认证")}`),
			kv(theme, "◈", "运行", "Goal off  ·  Plan off  ·  子代理并行 4  ·  厂商 0/38"),
			kv(theme, "▤", "上下文", `${gauge(theme, 0.42, 12)} 42%  ·  38k / 200k`),
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

const which = process.argv[2] ?? "pi-carbon";
const width = Number(process.argv[3] ?? 96);
const tabHops = Number(process.argv[4] ?? 0);
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
