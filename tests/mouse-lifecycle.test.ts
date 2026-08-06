/**
 * 鼠标开关的生命周期。
 *
 * 这里的重点是 dispose 一定要写 MOUSE_OFF：漏掉的话控制台关闭后终端仍在上报鼠标，
 * 用户会看到 stdin 里不断冒出 `\x1b[<...M` 这类乱码，且只能重启终端恢复。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { MOUSE_OFF, MOUSE_ON } from "../extensions/pi-extends/mouse.ts";
import { OVERLAY_COL, OVERLAY_ROW, runMenu } from "../extensions/pi-extends/ui-kit.ts";

/** 卡片行号 → SGR 序列里的行号（overlay 偏移 + 1-based）。 */
function sgrRow(cardRow: number): number {
	return cardRow + OVERLAY_ROW + 1;
}

/** 卡片列号 → SGR 序列里的列号。 */
function sgrCol(cardCol: number): number {
	return cardCol + OVERLAY_COL + 1;
}

function fakeTheme(): any {
	return {
		fg: (_c: string, t: string) => t,
		bg: (_c: string, t: string) => t,
		bold: (t: string) => t,
		dim: (t: string) => t,
		italic: (t: string) => t,
		underline: (t: string) => t,
		strikethrough: (t: string) => t,
	};
}

/** 记录 terminal.write 和输入监听器的假 TUI。 */
function fakeTui() {
	const writes: string[] = [];
	const listeners: ((d: string) => any)[] = [];
	return {
		writes,
		listeners,
		tui: {
			terminal: { rows: 40, columns: 100, write: (d: string) => writes.push(d) },
			requestRender: () => {},
			addInputListener: (l: (d: string) => any) => {
				listeners.push(l);
				return () => {
					const i = listeners.indexOf(l);
					if (i >= 0) listeners.splice(i, 1);
				};
			},
		} as any,
	};
}

/**
 * 假 host：立刻跑 factory 拿到组件，把 done 和组件都暴露出来，
 * 这样测试可以手动驱动「打开 → 交互 → 关闭」。
 */
function fakeHost(tui: any) {
	let component: any;
	let doneFn: ((v: any) => void) | undefined;
	let usedOptions: any;
	const host = {
		ui: {
			custom: (factory: any, options: any) => {
				usedOptions = typeof options?.overlayOptions === "function"
					? { ...options, resolved: options.overlayOptions() }
					: options;
				return new Promise((resolve) => {
					doneFn = resolve;
					component = factory(tui, fakeTheme(), { matches: () => false }, resolve);
				});
			},
		},
	} as any;
	return {
		host,
		get component() {
			return component;
		},
		get options() {
			return usedOptions;
		},
		finish: (v: any) => doneFn?.(v),
	};
}

const ITEMS = [
	{ id: "a", group: "外观", label: "主题" },
	{ id: "b", group: "模型", label: "主模型" },
];

test("mouse: true 时开启跟踪、走 overlay、dispose 时关闭", async () => {
	const { tui, writes, listeners } = fakeTui();
	const h = fakeHost(tui);
	const promise = runMenu(h.host, { title: "T", items: ITEMS, tabs: true, mouse: true });

	// 开启序列已写出。
	assert.deepEqual(writes, [MOUSE_ON], "应立刻开启鼠标跟踪");
	assert.equal(listeners.length, 1, "应注册一个输入监听器");

	// 必须走 overlay，且给了确定的 row/col —— 点击映射依赖这个几何。
	assert.equal(h.options?.overlay, true, "mouse 模式必须用 overlay");
	assert.equal(typeof h.options?.resolved?.row, "number");
	assert.equal(typeof h.options?.resolved?.col, "number");

	// 装了 exit 兜底：信号打断时 pi 不走 dispose，得靠它关掉跟踪。
	const exitBefore = process.listenerCount("exit");

	// 关闭：dispose 必须写 MOUSE_OFF 并摘掉监听器。
	h.component.dispose();
	assert.deepEqual(writes, [MOUSE_ON, MOUSE_OFF], "dispose 必须关闭鼠标跟踪");
	assert.equal(listeners.length, 0, "dispose 必须摘掉监听器");
	// dispose 也要摘掉 exit 处理器，否则反复开关控制台会堆积监听器。
	assert.equal(
		process.listenerCount("exit"),
		exitBefore - 1,
		"dispose 应摘掉 exit 兜底处理器",
	);

	h.finish(undefined);
	await promise;
});

test("overlay 必须铺满终端宽度，否则两侧漏出对话内容", async () => {
	const { tui } = fakeTui();
	const h = fakeHost(tui);
	const promise = runMenu(h.host, { title: "T", items: ITEMS, tabs: true, mouse: true });

	// overlay 从第 0 列开始铺满整行 —— 只覆盖中间一条会漏出底下的转录文字。
	assert.equal(h.options?.resolved?.col, 0, "overlay 必须从第 0 列开始");

	// 视口比卡片排版宽度（96）宽时，每一行都要补齐到视口宽度。
	const viewport = 140;
	for (const line of h.component.render(viewport)) {
		assert.equal(visibleWidth(line), viewport, `行未铺满视口: ${JSON.stringify(line)}`);
	}

	h.component.dispose();
	h.finish(undefined);
	await promise;
});

test("mouse 未开启时不碰终端，也不用 overlay", async () => {
	const { tui, writes, listeners } = fakeTui();
	const h = fakeHost(tui);
	const promise = runMenu(h.host, { title: "T", items: ITEMS });

	assert.deepEqual(writes, [], "没开鼠标就不该写任何控制序列");
	assert.equal(listeners.length, 0);
	assert.equal(h.options, undefined, "默认应保持内联渲染");

	h.finish(undefined);
	await promise;
});

test("滚轮与点击被消费，普通按键放行", async () => {
	const { tui, listeners } = fakeTui();
	const h = fakeHost(tui);
	const promise = runMenu(h.host, { title: "T", items: ITEMS, tabs: true, mouse: true });
	const listener = listeners[0]!;

	// 鼠标序列一律吞掉，否则 ESC[ 会漏进搜索框。
	assert.deepEqual(listener("\x1b[<64;5;5M"), { consume: true }, "滚轮应被消费");
	assert.deepEqual(listener("\x1b[<0;5;5M"), { consume: true }, "按下应被消费");
	assert.deepEqual(listener("\x1b[<0;5;5m"), { consume: true }, "松开应被消费");

	// 非鼠标输入必须放行，不然键盘就不能用了。
	assert.equal(listener("a"), undefined, "普通字符应放行");
	assert.equal(listener("\x1b[A"), undefined, "方向键应放行");
	assert.equal(listener("\t"), undefined, "Tab 应放行");

	h.component.dispose();
	h.finish(undefined);
	await promise;
});

test("行号换算准确：点标题行不会误选菜单项", async () => {
	const { tui, listeners } = fakeTui();
	const h = fakeHost(tui);
	const promise = runMenu(h.host, { title: "T", items: ITEMS, tabs: true, mouse: true });
	const listener = listeners[0]!;
	h.component.render(80);

	// 卡片第 0 行是标题，上面没有可点目标。
	listener(`\x1b[<0;${sgrCol(10)};${sgrRow(0)}m`);
	listener(`\x1b[<0;${sgrCol(10)};${sgrRow(0)}m`);
	// 标题行没有可点目标，promise 不该 resolve。用一个短超时确认它还悬着。
	const raced = await Promise.race([
		promise,
		new Promise((r) => setTimeout(() => r("__pending__"), 20)),
	]);
	assert.equal(raced, "__pending__", "点标题行不该选中任何项");

	h.component.dispose();
	h.finish(undefined);
	await promise;
});

test("点击卡片内的菜单行会选中对应项", async () => {
	const { tui, listeners } = fakeTui();
	const h = fakeHost(tui);
	const promise = runMenu(h.host, { title: "T", items: ITEMS, tabs: true, mouse: true });
	const listener = listeners[0]!;

	// 先渲染一次，让 rowMap / bodyOffset 就位。
	const lines = h.component.render(80);
	const row = lines.findIndex((l: string) => l.includes("主题"));
	assert.ok(row >= 0, "应渲染出主题一行");

	// 松开事件才触发。第一次点击移动光标，第二次确认。
	listener(`\x1b[<0;${sgrCol(10)};${sgrRow(row)}m`);
	h.component.render(80);
	listener(`\x1b[<0;${sgrCol(10)};${sgrRow(row)}m`);

	// 加超时兜底：点不中时 promise 永远不 resolve，裸 await 会把整个测试套件挂住。
	const picked = await Promise.race([
		promise,
		new Promise((r) => setTimeout(() => r("__timeout__"), 200)),
	]);
	assert.equal(picked, "a", "点击应选中第一项");
	h.component.dispose();
});
