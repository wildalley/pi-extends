import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { Card, MenuList, badge, gauge, kv } from "../extensions/pi-extends/ui-kit.ts";

/** 卡片最大宽度，与 ui-kit 内部常量保持一致。 */
const MAX_CARD_WIDTH = 96;

/** 最小主题替身：只保留 Card/MenuList 用到的方法，颜色部分透传。 */
function fakeTheme(): any {
	return {
		fg: (_c: string, t: string) => t,
		bg: (_c: string, t: string) => `\x1b[7m${t}\x1b[27m`,
		bold: (t: string) => t,
		dim: (t: string) => t,
		italic: (t: string) => t,
		underline: (t: string) => t,
		strikethrough: (t: string) => t,
	};
}

function buildCard(): Card {
	const theme = fakeTheme();
	const tui: any = { terminal: { rows: 40, columns: 100 }, requestRender: () => {} };
	const keys: any = { matches: () => false };
	const items = [
		{ id: "theme", group: "外观", icon: "◐", label: "主题", hotkey: "1", value: "pi-carbon", hint: "移动光标即时预览" },
		{ id: "footer", group: "外观", icon: "▤", label: "状态栏 Footer", hotkey: "2", value: "on", hint: "cometix 单行 · TPS on" },
		{ id: "model", group: "模型", icon: "◆", label: "主模型", hotkey: "3", value: "claude-opus-4-20250514", hint: "thinking high" },
		{ id: "roles", group: "模型", icon: "◇", label: "角色模型与权限", hotkey: "4", value: "2/4 已定制", hint: "scout · planner · worker · reviewer" },
		{ id: "status", group: "系统", icon: "▣", label: "状态总览", hotkey: "s", hint: "模型 / 角色 / 厂商 / 上下文一页看全" },
	];
	const menu = new MenuList(theme, tui, keys, {
		items,
		maxVisible: 14,
		onSelect: () => {},
		onCancel: () => {},
	});
	return new Card(theme, {
		title: "Pi Extends 控制台",
		titleRight: "pi-carbon · v1",
		status: () => [
			kv(theme, "◆", "模型", `claude-opus-4  ·  thinking high  ·  ${badge(theme, "已认证")}`),
			kv(theme, "▤", "上下文", `${gauge(theme, 0.42, 12)} 42%  ·  38k / 200k`),
		],
		hints: () => [
			{ key: "↑↓", label: "移动" },
			{ key: "⏎", label: "选择" },
			{ key: "esc", label: "返回" },
		],
		body: menu,
	});
}

test("Card 每一行的显示宽度都等于卡片宽度", () => {
	const card = buildCard();
	for (const width of [104, 96, 80, 70, 56, 50, 40]) {
		for (const line of card.render(width)) {
			assert.equal(visibleWidth(line), Math.min(width, MAX_CARD_WIDTH), `width=${width}: ${line}`);
		}
	}
});

test("Card 不画任何边框字符", () => {
	const card = buildCard();
	for (const width of [96, 50]) {
		for (const line of card.render(width)) {
			assert.ok(!/[╭╮╰╯│├┤─]/.test(line), `width=${width} 出现边框: ${line}`);
		}
	}
	assert.ok(card.render(96)[0]?.startsWith("  ●"));
});

test("MenuList 选中行只铺到内容块末尾，不铺满整行", () => {
	const card = buildCard();
	const lines = card.render(96);
	const selected = lines.find((line) => line.includes("\x1b[7m"));
	assert.ok(selected, "应该有一行带选中背景");
	const inner = selected.slice(selected.indexOf("\x1b[7m") + 4, selected.indexOf("\x1b[27m"));
	const width = visibleWidth(inner);
	// 铺满整行会在右边拖出几十列纯色块，比内容还抢眼；这里只铺到数值列末尾。
	assert.ok(width < MAX_CARD_WIDTH - 2, `选中行铺了 ${width} 列，等于铺满整行`);
	// 但也得真的把内容包住：光标 + 标签 + 数值都在色块里。
	assert.ok(inner.includes("主题") && inner.includes("pi-carbon"), `色块没包住内容: ${inner}`);
	// 整行仍然补齐到卡片宽度（否则选中行会短一截）。
	assert.equal(visibleWidth(selected), MAX_CARD_WIDTH);
	// 只有选中项展示 hint，未选中项的 hint 不出现在任何一行里。
	assert.ok(lines.some((l) => l.includes("移动光标即时预览")));
	assert.ok(!lines.some((l) => l.includes("cometix 单行")));
});

test("说明行位置固定：光标移动不会让下面的行整体错开", () => {
	const card = buildCard();
	const before = card.render(96);
	const menu = (card as unknown as { opts: { body: MenuList } }).opts.body;
	menu.scrollBy(1);
	const after = card.render(96);
	assert.equal(after.length, before.length, "移动光标后卡片高度变了，列表会看起来在抖");
	// 说明文字换成了新选中项的，但仍在同一行号上。
	const row = before.findIndex((l) => l.includes("移动光标即时预览"));
	assert.ok(row > 0, "第一项的说明应当渲染出来");
	assert.ok(after[row]?.includes("cometix 单行"), `说明行应停在第 ${row} 行: ${after[row]}`);
});
