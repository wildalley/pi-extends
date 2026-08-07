import { test } from "node:test";
import assert from "node:assert/strict";
import type { NotificationsConfig } from "../extensions/pi-extends/config.ts";
import {
	formatDuration,
	notifyCommand,
	sanitizeLine,
	shouldNotifyIdle,
} from "../extensions/pi-extends/notify.ts";

// 用 fromCharCode 造控制字符，而不是往测试源码里塞真控制字节。
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

const base: NotificationsConfig = {
	enabled: true,
	minSeconds: 20,
	onIdle: true,
	onAdvisorBlocker: true,
	onSubagent: false,
};

test("sanitizeLine 剥掉 ANSI 与控制字符", () => {
	assert.equal(sanitizeLine(`${ESC}[2m灰的${ESC}[0m`, 80), "灰的");
	assert.equal(sanitizeLine(`${ESC}]0;标题${BEL}正文`, 80), "正文");
	assert.equal(sanitizeLine("上\n下\t中", 80), "上 下 中");
	assert.equal(sanitizeLine("   两边留白   ", 80), "两边留白");
});

test("sanitizeLine 截断后长度不超过上限", () => {
	const out = sanitizeLine("x".repeat(50), 10);
	assert.equal(out.length, 10);
	assert.ok(out.endsWith("…"));
});

test("shouldNotifyIdle 只在跑够久且开关打开时为真", () => {
	assert.equal(shouldNotifyIdle(19_999, base), false);
	assert.equal(shouldNotifyIdle(20_000, base), true);
	assert.equal(shouldNotifyIdle(60_000, { ...base, enabled: false }), false);
	assert.equal(shouldNotifyIdle(60_000, { ...base, onIdle: false }), false);
	// minSeconds: 0 表示每轮都通知
	assert.equal(shouldNotifyIdle(0, { ...base, minSeconds: 0 }), true);
	assert.equal(shouldNotifyIdle(Number.NaN, base), false);
	assert.equal(shouldNotifyIdle(-1, base), false);
});

test("notifyCommand 在 Linux 上用 notify-send，且不经 shell", () => {
	const cmd = notifyCommand({ title: "pi", body: "$(rm -rf /) `whoami`" }, "linux");
	assert.ok(cmd);
	assert.equal(cmd.command, "notify-send");
	// 正文作为独立 argv 元素传入，永远不会被解释
	assert.equal(cmd.args.at(-1), "$(rm -rf /) `whoami`");
	assert.ok(cmd.args.includes("--"));
	assert.ok(cmd.args.includes("--app-name=pi"));
});

test("notifyCommand 在 macOS 上转义 osascript 字面量", () => {
	const cmd = notifyCommand({ title: 'a"b', body: "c\\d" }, "darwin");
	assert.ok(cmd);
	assert.equal(cmd.command, "osascript");
	assert.equal(cmd.args[0], "-e");
	assert.ok(cmd.args[1].includes('with title "a\\"b"'));
	assert.ok(cmd.args[1].includes('display notification "c\\\\d"'));
});

test("notifyCommand 在没有已知命令的平台上返回 null", () => {
	assert.equal(notifyCommand({ title: "t", body: "b" }, "win32"), null);
});

test("notifyCommand 空标题回落到 pi", () => {
	const cmd = notifyCommand({ title: `${ESC}[0m`, body: "x" }, "linux");
	assert.ok(cmd);
	assert.equal(cmd.args.at(-2), "pi");
});

test("formatDuration 说人话", () => {
	assert.equal(formatDuration(0), "0s");
	assert.equal(formatDuration(1_500), "2s");
	assert.equal(formatDuration(59_000), "59s");
	assert.equal(formatDuration(60_000), "1m");
	assert.equal(formatDuration(95_000), "1m35s");
	assert.equal(formatDuration(3_600_000), "1h0m");
	assert.equal(formatDuration(-5), "0s");
});
