/**
 * footer 的用量累计：恢复会话时 seed 自哪条路径。
 *
 * 会话是一棵树。rewind 之后 getEntries() 仍然返回整个文件（含被抛弃的分支），
 * 拿它 seed 会把废弃分支的 token 一起累进去 —— footer 显示的用量高于当前上下文
 * 实际对应的量，而这种偏差不会以任何形式报错，只会让人以为自己烧了更多钱。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import registerFooter, { UsageTotals } from "../extensions/pi-extends/footer.ts";
import { makeHarness } from "./helpers/extension-harness.ts";

function assistantEntry(usage: Record<string, unknown>) {
	return { type: "message", message: { role: "assistant", content: [], usage } };
}

test("seedFrom 只累计 assistant 消息的用量", () => {
	const totals = new UsageTotals();
	totals.seedFrom([
		assistantEntry({ input: 100, output: 10, cacheRead: 40, cacheWrite: 0, cost: { total: 0.5 } }),
		{ type: "message", message: { role: "user", content: [] } },
		{ type: "custom", customType: "plan-mode", data: {} },
		assistantEntry({ input: 200, output: 20, cacheRead: 60, cacheWrite: 0, cost: { total: 1.0 } }),
	]);
	assert.equal(totals.input, 300);
	assert.equal(totals.output, 30);
	assert.equal(totals.cacheRead, 100);
	assert.equal(totals.turns, 2);
	assert.equal(Number(totals.cost.toFixed(3)), 1.5);
});

test("seedFrom 前先清零，重复 seed 不会翻倍", () => {
	const totals = new UsageTotals();
	const entries = [assistantEntry({ input: 100, output: 10 })];
	totals.seedFrom(entries);
	totals.seedFrom(entries);
	assert.equal(totals.input, 100);
	assert.equal(totals.turns, 1);
});

test("lastCacheHit 取最后一轮的命中率", () => {
	const totals = new UsageTotals();
	totals.seedFrom([
		assistantEntry({ input: 0, output: 10, cacheRead: 100, cacheWrite: 0 }),
		assistantEntry({ input: 50, output: 10, cacheRead: 50, cacheWrite: 0 }),
	]);
	assert.equal(totals.lastCacheHit, 50);
});

test("session_start 从 getBranch() 取 entries，不是 getEntries()", () => {
	const h = makeHarness();
	// installFooter 需要 ctx.ui.setFooter，harness 没有；seedFrom 在 mode 检查之前执行，
	// 所以用非 tui 模式跑到 seed 就返回，正好只测这一段。
	(h.ctx as unknown as { mode: string }).mode = "headless";
	registerFooter(h.pi);

	h.entries.push(assistantEntry({ input: 100, output: 10 }));
	// 被 rewind 抛弃的分支：只出现在 getEntries() 里。
	h.stray.push(assistantEntry({ input: 999, output: 999 }));

	h.sessionCalls.length = 0;
	void h.emit("session_start");

	assert.deepEqual(h.sessionCalls, ["getBranch"]);
	assert.ok(!h.sessionCalls.includes("getEntries"), "不该读整个文件");
});
