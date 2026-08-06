/**
 * 分栏菜单：tab 由 item.group 推导，一次只显示一组，搜索跨组。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { MenuList } from "../extensions/pi-extends/ui-kit.ts";

function fakeTheme(): any {
	return {
		fg: (_c: string, t: string) => t,
		bg: (_c: string, t: string) => t,
		bold: (t: string) => t,
		dim: (t: string) => t,
		italic: (t: string) => t,
		underline: (t: string) => t,
		strikethrough: (t: string) => t,
	};
}

const ITEMS = [
	{ id: "theme", group: "外观", label: "主题" },
	{ id: "footer", group: "外观", label: "状态栏" },
	{ id: "model", group: "模型", label: "主模型" },
	{ id: "roles", group: "模型", label: "角色权限" },
	{ id: "goal", group: "工作流", label: "Goal 模式" },
];

function build(opts: Partial<Record<string, unknown>> = {}) {
	const selected: string[] = [];
	const tui: any = { terminal: { rows: 40, columns: 100 }, requestRender: () => {} };
	const keys: any = { matches: () => false };
	const menu = new MenuList(fakeTheme(), tui, keys, {
		items: ITEMS,
		maxVisible: 20,
		tabs: true,
		onSelect: (i: any) => selected.push(i.id),
		onCancel: () => {},
		...opts,
	} as any);
	return { menu, selected };
}

test("分栏模式只渲染当前 tab 的项，tab 名全部列出", () => {
	const { menu } = build();
	const text = menu.render(80).join("\n");
	// tab 条列出全部三组。
	for (const tab of ["外观", "模型", "工作流"]) {
		assert.ok(text.includes(tab), `tab 条缺少 ${tab}`);
	}
	// 只显示第一组的两项。
	assert.ok(text.includes("主题"));
	assert.ok(text.includes("状态栏"));
	assert.ok(!text.includes("主模型"), "不该显示其他 tab 的项");
	assert.ok(!text.includes("Goal 模式"));
});

test("Tab 键切到下一栏，←→ 也能切", () => {
	const { menu } = build();
	menu.handleInput("\t");
	let text = menu.render(80).join("\n");
	assert.ok(text.includes("主模型"), "Tab 后应显示模型栏");
	assert.ok(!text.includes("主题"), "旧栏的项应消失");

	// Shift-Tab 回到上一栏。
	menu.handleInput("\x1b[Z");
	text = menu.render(80).join("\n");
	assert.ok(text.includes("主题"));

	// → 前进，← 后退。
	menu.handleInput("\x1b[C");
	assert.ok(menu.render(80).join("\n").includes("主模型"));
	menu.handleInput("\x1b[D");
	assert.ok(menu.render(80).join("\n").includes("主题"));
});

test("切栏会绕回，不会走到空栏", () => {
	const { menu } = build();
	// 三栏，切三次回到第一栏。
	for (let i = 0; i < 3; i++) menu.handleInput("\t");
	assert.ok(menu.render(80).join("\n").includes("主题"), "应绕回第一栏");
	// 反向也要能绕：从第一栏往前退一步应到最后一栏。
	menu.handleInput("\x1b[Z");
	assert.ok(menu.render(80).join("\n").includes("Goal 模式"), "反向应绕到最后一栏");
});

test("搜索跨全部 tab，清空后回到当前 tab", () => {
	const { menu } = build({ search: "always" });
	// 搜第三栏的项，当前停在第一栏。
	for (const ch of "Goal") menu.handleInput(ch);
	let text = menu.render(80).join("\n");
	assert.ok(text.includes("Goal 模式"), "搜索应能跨栏命中");

	// 退格清空搜索词后，回到当前 tab 的范围。
	for (let i = 0; i < 4; i++) menu.handleInput("\x7f");
	text = menu.render(80).join("\n");
	assert.ok(text.includes("主题"));
	assert.ok(!text.includes("Goal 模式"));
});

test("initialId 决定初始 tab", () => {
	const { menu } = build({ initialId: "goal" });
	const text = menu.render(80).join("\n");
	assert.ok(text.includes("Goal 模式"), "应直接停在 goal 所在的栏");
	assert.ok(!text.includes("主题"));
});

test("点击菜单行：第一次移光标，再点确认", () => {
	const { menu, selected } = build();
	const lines = menu.render(80);
	// 找到「状态栏」那一行的行号。
	const row = lines.findIndex((l) => l.includes("状态栏"));
	assert.ok(row >= 0, "应渲染出状态栏一行");

	// 第一次点击只移动光标。
	assert.equal(menu.clickAt(row, 10), true);
	assert.deepEqual(selected, [], "第一次点击不该直接选中");

	// 重新渲染后再点同一项才确认。
	const rows2 = menu.render(80);
	const row2 = rows2.findIndex((l) => l.includes("状态栏"));
	assert.equal(menu.clickAt(row2, 10), true);
	assert.deepEqual(selected, ["footer"], "第二次点击应确认选中");
});

test("点击 tab 条按列号切栏", () => {
	const { menu } = build();
	const lines = menu.render(80);
	const tabRow = lines.findIndex((l) => l.includes("外观") && l.includes("模型"));
	assert.ok(tabRow >= 0, "应有 tab 条");

	// clickAt 收的是显示列号，而 indexOf 给的是字符下标 ——
	// 「外观」两个字符占四列，两者不等价，得先换算。
	const line = lines[tabRow]!;
	const modelCol = visibleWidth(line.slice(0, line.indexOf("模型")));
	assert.equal(menu.clickAt(tabRow, modelCol), true);
	assert.ok(menu.render(80).join("\n").includes("主模型"), "点击应切到模型栏");

	// 点在 tab 条的空白处不该切栏。
	assert.equal(menu.clickAt(tabRow, 200), false);
});

test("滚轮移动光标", () => {
	const { menu, selected } = build();
	menu.scrollBy(1);
	const lines = menu.render(80);
	// 光标下移一行后，第二项成为选中项；点它应直接确认。
	const row = lines.findIndex((l) => l.includes("状态栏"));
	menu.clickAt(row, 10);
	assert.deepEqual(selected, ["footer"]);
});
