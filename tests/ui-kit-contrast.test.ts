/**
 * 锁住选中行的可读性。
 *
 * 选中行铺 `selectedBg` 后，暗色 tone 会糊成一团 —— 实测 borderMuted 1.10–1.42:1、
 * thinkingOff 1.10–2.01:1、dim 2.49–4.91:1（全部 5 套主题）。这里把「选中行不得出现
 * 这三个 tone」写成断言，以后新增 tone 或改 renderItem 时不至于把问题带回来。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { MenuList, onSelectedBg } from "../extensions/pi-extends/ui-kit.ts";

const LOW_CONTRAST = ["dim", "thinkingOff", "borderMuted"] as const;

test("onSelectedBg 只在选中时替换低对比度 tone", () => {
	for (const tone of LOW_CONTRAST) {
		assert.equal(onSelectedBg(tone, true), "text", `${tone} 在选中行应换成 text`);
		assert.equal(onSelectedBg(tone, false), tone, `${tone} 在未选中行应保持原样`);
	}
	// 够亮或带语义的 tone 不动，否则会丢掉「警告 / 错误」这类信息。
	for (const tone of ["muted", "accent", "text", "success", "warning", "error"] as const) {
		assert.equal(onSelectedBg(tone, true), tone, `${tone} 不该被替换`);
	}
});

/** 记录每段文字用了哪个 tone，用来检查选中行的实际着色。 */
function recordingTheme(log: { tone: string; text: string }[]): any {
	let inSelectedBg = false;
	return {
		fg: (tone: string, text: string) => {
			if (inSelectedBg) log.push({ tone, text });
			return text;
		},
		// bg 是最外层调用：此时行内的 fg 已经执行完了，所以用 bg 的入参反推整行内容。
		bg: (_c: string, text: string) => text,
		bold: (t: string) => t,
		dim: (t: string) => t,
		italic: (t: string) => t,
		underline: (t: string) => t,
		strikethrough: (t: string) => t,
		__enter: () => {
			inSelectedBg = true;
		},
	};
}

test("MenuList 选中行不使用在 selectedBg 上读不清的 tone", () => {
	const log: { tone: string; text: string }[] = [];
	const theme = recordingTheme(log);
	theme.__enter();
	const tui: any = { terminal: { rows: 40, columns: 100 }, requestRender: () => {} };
	const keys: any = { matches: () => false };

	// 三个条目都显式带低对比度 tone，且开启多选（勾选框用 borderMuted）。
	const items = [
		{ id: "a", label: "第一项", tone: "dim" as const, hotkey: "1", value: "v1" },
		{ id: "b", label: "第二项", tone: "thinkingOff" as const, hotkey: "2", value: "v2" },
		{ id: "c", label: "第三项", tone: "borderMuted" as const, hotkey: "3", value: "v3" },
	];
	const menu = new MenuList(theme, tui, keys, {
		items,
		maxVisible: 14,
		multi: true,
		onSelect: () => {},
		onCancel: () => {},
	});
	menu.render(80);

	// 选中项是第一项，它的标签文字不该带 dim。
	const first = log.find((e) => e.text.includes("第一项"));
	assert.ok(first, "应该渲染出第一项");
	assert.ok(
		!LOW_CONTRAST.includes(first.tone as (typeof LOW_CONTRAST)[number]),
		`选中行标签用了低对比度 tone: ${first.tone}`,
	);

	// 未选中的两项保留自己的 tone —— 弱化在非选中行是有意义的。
	const second = log.find((e) => e.text.includes("第二项"));
	assert.equal(second?.tone, "thinkingOff");
});
