import { test } from "node:test";
import assert from "node:assert/strict";
import { applyKeywords, findMagicKeywords, maskNonProse } from "../extensions/pi-extends/keywords.ts";

test("散文里的关键词会命中", () => {
	assert.deepEqual(findMagicKeywords("ultrathink 帮我看看这个 bug"), ["ultrathink"]);
	assert.deepEqual(findMagicKeywords("先 orchestrate，再 workflowz"), ["orchestrate", "workflowz"]);
	assert.deepEqual(findMagicKeywords("句末也算 ultrathink。"), ["ultrathink"]);
});

test("代码块与行内代码里的关键词不命中", () => {
	assert.deepEqual(findMagicKeywords("```\nultrathink\n```"), []);
	assert.deepEqual(findMagicKeywords("看 `ultrathink` 这个词"), []);
	assert.deepEqual(findMagicKeywords("~~~ts\nconst x = 'orchestrate';\n~~~"), []);
	// 未闭合的围栏也当作代码块，避免粘贴一半代码就被劫持。
	assert.deepEqual(findMagicKeywords("```py\nworkflowz\n"), []);
});

test("标识符、路径与标签里的关键词不命中", () => {
	assert.deepEqual(findMagicKeywords("调用 ultrathink_mode()"), []);
	assert.deepEqual(findMagicKeywords("打开 src/orchestrate.ts"), []);
	assert.deepEqual(findMagicKeywords("<workflowz>"), []);
	assert.deepEqual(findMagicKeywords("参数 --ultrathink"), []);
	assert.deepEqual(findMagicKeywords("Ultrathink 大写不算"), []);
});

test("maskNonProse 保留行数与非代码文本", () => {
	const masked = maskNonProse("前面\n```\nultrathink\n```\n后面");
	assert.equal(masked.split("\n").length, 5);
	assert.ok(masked.includes("前面"));
	assert.ok(masked.includes("后面"));
	assert.ok(!masked.includes("ultrathink"));
});

test("applyKeywords 保留原文并追加指令块", () => {
	assert.equal(applyKeywords("原文", []), "原文");
	const out = applyKeywords("原文", ["ultrathink"]);
	assert.ok(out.startsWith("原文"));
	assert.ok(out.includes("<pi-extends-keywords>"));
	assert.ok(out.includes("</pi-extends-keywords>"));
});
