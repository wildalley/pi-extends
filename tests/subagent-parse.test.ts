import { test } from "node:test";
import assert from "node:assert/strict";
import {
	formatUsage,
	getFinalOutput,
	isMessageEndEvent,
	isToolResultEndEvent,
	parseJsonlLine,
	truncateOutput,
} from "../extensions/pi-extends/subagent-parse.ts";

test("parseJsonlLine 解析合法事件", () => {
	const event = parseJsonlLine('{"type":"session","id":"abc"}');
	assert.deepEqual(event, { type: "session", id: "abc" });
});

test("parseJsonlLine 忽略空行和非法 JSON", () => {
	assert.equal(parseJsonlLine(""), undefined);
	assert.equal(parseJsonlLine("   "), undefined);
	assert.equal(parseJsonlLine("not json"), undefined);
	assert.equal(parseJsonlLine('{"noType":1}'), undefined);
	assert.equal(parseJsonlLine('42'), undefined);
});

test("事件类型守卫", () => {
	const msgEnd = parseJsonlLine(
		'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}',
	);
	assert.ok(msgEnd && isMessageEndEvent(msgEnd));
	assert.ok(msgEnd && !isToolResultEndEvent(msgEnd));

	const toolEnd = parseJsonlLine(
		'{"type":"tool_result_end","message":{"role":"toolResult","content":[{"type":"text","text":"out"}]}}',
	);
	assert.ok(toolEnd && isToolResultEndEvent(toolEnd));
	assert.ok(toolEnd && !isMessageEndEvent(toolEnd));
});

test("getFinalOutput 取最后一个 assistant 文本", () => {
	const messages = [
		{ role: "user", content: [{ type: "text", text: "question" }] },
		{ role: "assistant", content: [{ type: "text", text: "answer" }] },
	] as never;
	assert.equal(getFinalOutput(messages as never), "answer");
});

test("getFinalOutput 无文本时返回空字符串", () => {
	assert.equal(getFinalOutput([]), "");
	const messages = [
		{ role: "assistant", content: [{ type: "thinking", text: "..." }] },
	] as never;
	assert.equal(getFinalOutput(messages as never), "");
});

test("truncateOutput 未超限原样返回", () => {
	const output = "hello world";
	assert.equal(truncateOutput(output, 1024), output);
});

test("truncateOutput 超限截断并保留完整提示", () => {
	const output = "x".repeat(100);
	const result = truncateOutput(output, 50);
	assert.ok(result.includes("[Output truncated:"));
	assert.ok(result.includes("bytes omitted"));
	assert.ok(Buffer.byteLength(result.split("\n\n[Output")[0], "utf8") <= 50);
});

test("truncateOutput 多字节字符不会被截断到非法 UTF-8", () => {
	const output = "汉字汉字汉字汉字".repeat(50);
	const result = truncateOutput(output, 60);
	assert.doesNotThrow(() => Buffer.from(result, "utf8").toString("utf8"));
});

test("formatUsage 只显示非零字段", () => {
	assert.equal(
		formatUsage({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 }),
		"",
	);
	const s = formatUsage(
		{ input: 1200, output: 300, cacheRead: 0, cacheWrite: 0, cost: 0.012, contextTokens: 2048, turns: 3 },
		"anthropic/claude",
	);
	assert.ok(s.includes("3 turns"));
	assert.ok(s.includes("↑1200"));
	assert.ok(s.includes("↓300"));
	assert.ok(s.includes("$0.0120"));
	assert.ok(s.includes("ctx:2048"));
	assert.ok(s.includes("anthropic/claude"));
});
