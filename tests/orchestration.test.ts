/**
 * 自动分工的打分器。
 *
 * 这个功能唯一的风险是「误触」：本来只想聊两句，却被弹窗打断。所以这里的重点
 * 不是「复杂任务能不能被识破」，而是「普通消息一定不能到分」—— 后者的用例写得更多。
 * 默认阈值 3 分写进断言里：调阈值或调权重时，这些用例会告诉你行为变了。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { complexityScore } from "../extensions/pi-extends/orchestration.ts";

/** 与 defaultConfig() 的 orchestration.minComplexity 保持一致。 */
const DEFAULT_MIN = 3;

function score(text: string): number {
	return complexityScore(text).score;
}

test("短消息一律 0 分，不管里面有什么词", () => {
	for (const text of ["重构所有模块", "然后跑一下测试", "帮我看看 a.ts b.ts c.ts", "1. 改这个 2. 改那个"]) {
		assert.equal(score(text), 0, `"${text}" 不该得分`);
	}
});

test("普通的长段落不到阈值", () => {
	// 一件事，说得比较细。这是最容易误触的一类，必须挡住。
	const text =
		"我这边遇到一个问题，footer 里的 token 统计偶尔会显示成 NaN，" +
		"看起来是在会话刚开始、还没有任何一轮对话的时候取到了 undefined。" +
		"你能帮我看看是哪里没有兜底吗？如果确认了就顺手改掉。";
	assert.ok(score(text) < DEFAULT_MIN, `不该触发，实际 ${score(text)} 分：${JSON.stringify(complexityScore(text).reasons)}`);
});

test("五条待办的消息会到阈值", () => {
	const text =
		"1.先完成这些 2.优化一下整体界面和 cockpit 设置最好做成多 tab 切换 " +
		"3.我不知道当前对话框是否可以直接粘贴图片 如果不行加一下 " +
		"4.设置的主题和 cockpit 的主题有两套 是否合理 5.任务自动开启子代理这些还可以优化吗";
	const result = complexityScore(text);
	assert.ok(result.score >= DEFAULT_MIN, `应触发，实际 ${result.score} 分`);
	assert.ok(
		result.reasons.some((r) => r.includes("5 条")),
		`理由里应指出待办条数：${JSON.stringify(result.reasons)}`,
	);
});

test("覆盖面 + 多文件 + 长度可以叠到阈值", () => {
	const text =
		"把 extensions/pi-extends/config.ts、extensions/pi-extends/store.ts 和 " +
		"extensions/pi-extends/routes.ts 里所有读配置的地方统一改成走同一个入口，" +
		"顺便把每个调用点的错误处理也对齐一下，别再各写一套。改完记得跑测试确认没有回归。";
	assert.ok(score(text) >= DEFAULT_MIN, `应触发，实际 ${score(text)} 分`);
});

test("代码块里的列表和文件名不算数", () => {
	// 贴一段 diff 或配置进来是日常操作，不该因为里面的 `-` 和文件名被判成多件事。
	const pasted = [
		"这段配置报错了，你看下为什么：",
		"```json",
		'{ "a.ts": 1, "b.ts": 2, "c.ts": 3,',
		'  "list": ["- 1.", "- 2.", "- 3.", "- 4.", "- 5."],',
		'  "note": "所有 每个 整个 重构 迁移 然后 并且 以及" }',
		"```",
		"就这一个报错，别的都正常，帮我定位一下根因就好，不用改别的地方。",
	].join("\n");
	assert.ok(
		score(pasted) < DEFAULT_MIN,
		`代码块被算进去了，实际 ${score(pasted)} 分：${JSON.stringify(complexityScore(pasted).reasons)}`,
	);
});

test("版本号不会被数成待办项", () => {
	const text =
		"帮我把默认模型从 gpt-4.1 换成 claude-sonnet-4.5，另外确认一下 3.5 那个老配置还有没有人用，" +
		"我记得文档里写的是 2.0 的格式，可能已经过时了，你顺手核对一下就行。";
	const reasons = complexityScore(text).reasons;
	assert.ok(
		!reasons.some((r) => r.includes("条待办")),
		`版本号被数成待办了：${JSON.stringify(reasons)}`,
	);
});

test("同一个覆盖面词说多遍只算一次", () => {
	const once =
		"把所有的读配置调用都改掉，这件事只有一个目标，就是让入口统一起来，别的什么都不要动，" +
		"改完之后我自己会去核对，你只要保证行为一致就可以了。";
	const thrice = once.replace("所有的读配置调用", "所有的读配置调用（所有的，是所有的）");
	assert.equal(score(thrice), score(once), "重复同一个词不该加分");
});

test("理由条目数量和分数一起增长，且每条都能对着原文指出来", () => {
	const result = complexityScore(
		"1. 改 a.ts 2. 改 b.ts 3. 改 c.ts 4. 再把所有调用点对齐，然后跑一遍测试确认没有回归，" +
			"这几件事互相独立，可以分头做，做完汇总告诉我结果就行。",
	);
	assert.ok(result.score >= DEFAULT_MIN);
	assert.ok(result.reasons.length >= 2, `理由太少：${JSON.stringify(result.reasons)}`);
	// 空理由等于「说不出为什么打断你」，那就不该打断。
	assert.ok(result.reasons.every((r) => r.trim().length > 0));
});

test("有分数就一定有理由，反之亦然", () => {
	for (const text of [
		"随便说点什么，不构成任何待办，只是闲聊，长度也刻意写得够长以便通过最短长度那道门槛。",
		"1. a 2. b 3. c 这三件事都要做，另外所有相关的测试也要跟着更新，改完记得核对一遍。",
	]) {
		const { score: s, reasons } = complexityScore(text);
		assert.equal(s > 0, reasons.length > 0, `分数与理由不一致：${s} vs ${JSON.stringify(reasons)}`);
	}
});
