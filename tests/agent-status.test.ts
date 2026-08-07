import { test } from "node:test";
import assert from "node:assert/strict";
import {
	formatAgentStatus,
	getAgentStatus,
	markAgentEnd,
	markAgentStart,
	resetAgentStatus,
} from "../extensions/pi-extends/agent-status.ts";

test("没派过子代理时 footer 不占槽", () => {
	resetAgentStatus();
	assert.equal(formatAgentStatus(), undefined);
});

test("并发计数按启动/结束配对，不被后一次调用覆盖", () => {
	resetAgentStatus();
	markAgentStart();
	markAgentStart();
	assert.deepEqual(getAgentStatus(), { running: 2, launched: 2, done: 0, failed: 0 });
	markAgentEnd(true);
	assert.deepEqual(getAgentStatus(), { running: 1, launched: 2, done: 1, failed: 0 });
	markAgentEnd(false);
	assert.deepEqual(getAgentStatus(), { running: 0, launched: 2, done: 1, failed: 1 });
	resetAgentStatus();
});

test("running 不会掉到负数", () => {
	resetAgentStatus();
	markAgentEnd(true);
	assert.equal(getAgentStatus().running, 0);
	resetAgentStatus();
});

test("footer 文案：进行中 / 有失败 / 全成功", () => {
	assert.match(formatAgentStatus({ running: 2, launched: 3, done: 1, failed: 0 })!, /2\/3 子代理/);
	assert.match(formatAgentStatus({ running: 0, launched: 3, done: 2, failed: 1 })!, /1\/3 子代理失败/);
	assert.match(formatAgentStatus({ running: 0, launched: 3, done: 3, failed: 0 })!, /3 子代理/);
});

test("reset 之后 footer 那一段消失", () => {
	resetAgentStatus();
	markAgentStart();
	markAgentEnd(true);
	assert.notEqual(formatAgentStatus(), undefined);
	resetAgentStatus();
	assert.equal(formatAgentStatus(), undefined);
});
