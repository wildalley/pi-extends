import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { menuColumns, padStartTo, padTo, splitRow } from "../extensions/pi-extends/ui-kit.ts";

test("padTo 补齐到指定列宽", () => {
	assert.equal(padTo("ab", 5), "ab   ");
	assert.equal(padTo("", 3), "   ");
	assert.equal(padTo("abc", 0), "");
});

test("padTo 超宽时截断且总宽不变", () => {
	const out = padTo("abcdefghij", 6);
	assert.equal(visibleWidth(out), 6);
	// truncateToWidth 会在省略号后追加重置序列，这里只断言省略号出现过。
	assert.ok(out.includes("…"));
	assert.ok(!out.includes("f"));
});

test("padTo 按显示宽度处理 CJK", () => {
	// 「中文」显示宽度为 4，补两格到 6。
	assert.equal(padTo("中文", 6), "中文  ");
	assert.equal(visibleWidth(padTo("中文字符", 5)), 5);
});

test("padStartTo 右对齐", () => {
	assert.equal(padStartTo("ab", 5), "   ab");
	assert.equal(visibleWidth(padStartTo("中文", 6)), 6);
});

test("splitRow 左右两端对齐且总宽等于给定宽度", () => {
	const row = splitRow("left", "right", 20);
	assert.equal(visibleWidth(row), 20);
	assert.ok(row.startsWith("left"));
	assert.ok(row.endsWith("right"));
});

test("splitRow 右侧过长时只保留右侧", () => {
	const row = splitRow("left", "0123456789", 8);
	assert.equal(visibleWidth(row), 8);
});

test("menuColumns 各列之和正好填满一行", () => {
	const items = [
		{ id: "a", label: "主题", hotkey: "1", value: "pi-carbon", hint: "即时预览" },
		{ id: "b", label: "角色模型与权限", hotkey: "2", value: "2/4 已定制", hint: "scout planner" },
	];
	for (const inner of [40, 56, 72, 104]) {
		const c = menuColumns(items, inner);
		const total = 2 + c.hotkey + c.check + c.label + (c.value > 0 ? c.value + 2 : 0) + c.trail;
		assert.equal(total, inner, `inner=${inner}`);
	}
});

test("menuColumns 宽terminal下内容成团靠左，窄terminal下压缩标签列", () => {
	const items = [
		{ id: "a", label: "主题", hotkey: "1", value: "pi-carbon" },
		{ id: "b", label: "角色模型与权限", hotkey: "2", value: "2/4 已定制" },
	];
	// 宽：标签与数值都只占所需宽度，余量全在行尾。
	const wide = menuColumns(items, 94);
	assert.equal(wide.label, 14); // 「角色模型与权限」显示宽度 14
	assert.equal(wide.value, 10); // 「2/4 已定制」显示宽度 10
	assert.ok(wide.trail > 0);
	// 窄：没有余量可留，标签列被压缩。
	const narrow = menuColumns(items, 30);
	assert.equal(narrow.trail, 0);
	assert.ok(narrow.label < 14);
});

test("menuColumns 无 hotkey 时不预留快捷键列，多选时预留勾选列", () => {
	const items = [{ id: "a", label: "read" }];
	assert.equal(menuColumns(items, 60).hotkey, 0);
	assert.equal(menuColumns(items, 60, true).check, 4);
});

test("menuColumns 无 value 时不预留数值列", () => {
	const items = [{ id: "a", label: "read", hint: "读取文件" }];
	assert.equal(menuColumns(items, 60).value, 0);
});
