import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	filterNotes,
	parseAdvisorOutput,
	renderNotes,
	summarizeNotes,
} from "../extensions/pi-extends/advisor-parse.ts";
import { wrapText } from "../extensions/pi-extends/ui-kit.ts";

function fakeTheme(): any {
	return {
		fg: (_c: string, t: string) => t,
		bold: (t: string) => t,
		dim: (t: string) => t,
	};
}

test("parseAdvisorOutput 解析三段式行", () => {
	const notes = parseAdvisorOutput(
		[
			"好的，我看了一下：",
			"concern :: 缺少空输入的处理 :: parseX 在传入空字符串时会抛错",
			"- blocker :: 会覆盖用户配置 :: 写入前没有读取已有文件",
			"aside :: 命名 :: 建议叫 resolveRoute",
		].join("\n"),
	);
	assert.equal(notes.length, 3);
	assert.deepEqual(notes[0], {
		severity: "concern",
		title: "缺少空输入的处理",
		body: "parseX 在传入空字符串时会抛错",
	});
	assert.equal(notes[1]?.severity, "blocker");
	assert.equal(notes[2]?.body, "建议叫 resolveRoute");
});

test("parseAdvisorOutput 忽略无关内容，缩进行接到上一条正文", () => {
	assert.deepEqual(parseAdvisorOutput("none"), []);
	assert.deepEqual(parseAdvisorOutput("没什么问题，做得不错。"), []);
	const notes = parseAdvisorOutput("concern :: 标题 :: 第一句\n  第二句");
	assert.equal(notes.length, 1);
	assert.equal(notes[0]?.body, "第一句 第二句");
});

test("parseAdvisorOutput 允许标题里带冒号，缺正文时正文为空", () => {
	const notes = parseAdvisorOutput("concern :: config.ts: 未处理错误");
	assert.equal(notes.length, 1);
	assert.equal(notes[0]?.title, "config.ts: 未处理错误");
	assert.equal(notes[0]?.body, "");
});

test("filterNotes 按阈值过滤并按严重程度排序", () => {
	const notes = parseAdvisorOutput(
		["aside :: a :: x", "blocker :: b :: y", "concern :: c :: z"].join("\n"),
	);
	assert.deepEqual(
		filterNotes(notes, "concern").map((n) => n.severity),
		["blocker", "concern"],
	);
	assert.equal(filterNotes(notes, "blocker").length, 1);
	assert.equal(filterNotes(notes, "aside").length, 3);
});

test("renderNotes 不超过给定宽度，且带等级标签", () => {
	const notes = parseAdvisorOutput(
		`concern :: 标题 :: ${"很长的中文说明".repeat(12)}`,
	);
	for (const width of [96, 60, 40]) {
		for (const line of renderNotes(fakeTheme(), notes, width).split("\n")) {
			assert.ok(visibleWidth(line) <= width, `width=${width}: ${line}`);
		}
	}
	assert.ok(renderNotes(fakeTheme(), notes, 96).includes("疑虑"));
});

test("summarizeNotes 给出纯文本摘要", () => {
	const notes = parseAdvisorOutput("blocker :: 标题 :: 正文");
	assert.equal(summarizeNotes(notes), "[blocker] 标题 — 正文");
});

test("wrapText 按显示宽度折行，CJK 按两列算", () => {
	const lines = wrapText("中文".repeat(10), 10);
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 10, line);
	}
	assert.equal(lines.join(""), "中文".repeat(10));
	assert.deepEqual(wrapText("a b c", 20), ["a b c"]);
	assert.deepEqual(wrapText("", 10), [""]);
});
