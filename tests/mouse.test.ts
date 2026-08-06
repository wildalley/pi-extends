import { test } from "node:test";
import assert from "node:assert/strict";
import { MOUSE_OFF, MOUSE_ON, isMouseSequence, parseMouse } from "../extensions/pi-extends/mouse.ts";

test("解析左键按下与松开，坐标转 0-based", () => {
	assert.deepEqual(parseMouse("\x1b[<0;20;5M"), {
		type: "press",
		button: 0,
		col: 19,
		row: 4,
	});
	assert.deepEqual(parseMouse("\x1b[<0;20;5m"), {
		type: "release",
		button: 0,
		col: 19,
		row: 4,
	});
});

test("解析滚轮上下", () => {
	assert.deepEqual(parseMouse("\x1b[<64;1;1M"), { type: "wheel", delta: -1, col: 0, row: 0 });
	assert.deepEqual(parseMouse("\x1b[<65;1;1M"), { type: "wheel", delta: 1, col: 0, row: 0 });
});

test("忽略拖动移动事件", () => {
	// 32 位置位 = 拖动中，本组件不处理，否则移动会被当成点击。
	assert.equal(parseMouse("\x1b[<32;10;3M"), undefined);
});

test("宽终端的大坐标不溢出", () => {
	// SGR 用十进制文本，300 列也能正确解析（老 X10 编码在 223 列就坏了）。
	const ev = parseMouse("\x1b[<0;300;120M");
	assert.equal(ev?.col, 299);
	assert.equal(ev?.row, 119);
});

test("非鼠标输入返回 undefined", () => {
	for (const data of ["a", "\x1b[A", "\t", "", "\x1b[<0;1M", "\x1b[<x;1;1M"]) {
		assert.equal(parseMouse(data), undefined, `不该解析: ${JSON.stringify(data)}`);
		assert.equal(isMouseSequence(data), false);
	}
	assert.equal(isMouseSequence("\x1b[<0;20;5M"), true);
});

test("开关序列成对且用 SGR 模式", () => {
	assert.ok(MOUSE_ON.includes("1006"), "必须启用 SGR 编码");
	assert.equal(MOUSE_ON.endsWith("h"), true);
	assert.equal(MOUSE_OFF.endsWith("l"), true);
	// 打开和关闭针对同一组模式，否则会留下残留状态。
	assert.equal(MOUSE_ON.slice(0, -1), MOUSE_OFF.slice(0, -1));
});
