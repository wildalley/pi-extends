/**
 * SGR 鼠标支持。
 *
 * 终端默认不上报鼠标，得先写 `ESC[?1000;1006h` 打开跟踪，退出时必须关掉 ——
 * 否则控制台关了以后终端还在往 stdin 里灌鼠标序列，用户会看到满屏乱码。
 *
 * 只用 SGR 模式（1006）。老的 X10 编码把坐标塞进单字节，超过 223 列就溢出，
 * 而 SGR 用十进制文本，宽终端下不会坏。
 */

/** 打开鼠标跟踪：按下/松开 + SGR 编码。 */
export const MOUSE_ON = "\x1b[?1000;1006h";
/** 关掉鼠标跟踪。顺序与打开相反，缺一个都会留下残留状态。 */
export const MOUSE_OFF = "\x1b[?1000;1006l";

export type MouseEvent =
	| { type: "press"; button: number; col: number; row: number }
	| { type: "release"; button: number; col: number; row: number }
	| { type: "wheel"; delta: -1 | 1; col: number; row: number };

/**
 * SGR 序列：`ESC [ < Cb ; Cx ; Cy (M|m)`
 * M = 按下，m = 松开。Cb 低两位是键号，64 起是滚轮。
 * 坐标是 1-based，这里统一转成 0-based。
 */
const SGR_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

export function parseMouse(data: string): MouseEvent | undefined {
	const m = SGR_RE.exec(data);
	if (!m) {
		return undefined;
	}
	const cb = Number(m[1]);
	const col = Number(m[2]) - 1;
	const row = Number(m[3]) - 1;
	if (!Number.isFinite(cb) || !Number.isFinite(col) || !Number.isFinite(row)) {
		return undefined;
	}
	// 滚轮：64 = 上，65 = 下。滚轮没有「松开」事件，只会是 M。
	if (cb >= 64 && cb < 68) {
		return { type: "wheel", delta: cb % 2 === 0 ? -1 : 1, col, row };
	}
	// 32 位是「拖动中移动」，本组件不需要拖动，忽略掉以免把移动当点击。
	if ((cb & 32) !== 0) {
		return undefined;
	}
	const button = cb & 3;
	return { type: m[4] === "M" ? "press" : "release", button, col, row };
}

/** data 里是否含鼠标序列 —— 用来决定要不要吞掉这段输入。 */
export function isMouseSequence(data: string): boolean {
	return SGR_RE.test(data);
}
