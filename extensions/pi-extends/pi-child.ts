/**
 * 拉起 pi 子进程的统一入口（subagent 与 advisor 共用）。
 *
 * 集中处理四件容易做错的事：
 * - **编码**：`setEncoding("utf8")` 让 Node 用 StringDecoder 处理跨 chunk 的多字节字符。
 *   直接 `data.toString()` 会把中文切成替换字符，那一行 JSONL 就废了。
 * - **超时**：子进程挂住时不能让工具调用无限期悬停。
 * - **输出上限**：失控的子进程不该把父进程内存吃满。
 * - **环境变量**：递归防护通过 `env` 传给子进程，而不是改 `process.env` ——
 *   后者是进程全局状态，并行子代理会互相覆盖。
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

/** 单个流的累积上限，超出后丢弃并标记截断。 */
export const DEFAULT_MAX_STREAM_BYTES = 8 * 1024 * 1024;
/** 子进程默认超时。 */
export const DEFAULT_CHILD_TIMEOUT_MS = 600_000;
/** SIGTERM 后等多久升级到 SIGKILL。 */
const KILL_GRACE_MS = 5000;

export interface PiChildOptions {
	args: string[];
	cwd: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	maxStreamBytes?: number;
	/** 追加到子进程环境（不影响父进程）。 */
	env?: Record<string, string>;
	/** 每收到一整行 stdout 调用一次，用于流式解析 JSONL。 */
	onLine?: (line: string) => void;
}

export interface PiChildResult {
	code: number;
	stdout: string;
	stderr: string;
	aborted: boolean;
	timedOut: boolean;
	truncated: boolean;
}

/**
 * 定位 pi 可执行文件。
 *
 * 优先复用当前进程的入口脚本，保证子进程与父进程是同一份 pi。
 * bun 的虚拟脚本路径（/$bunfs/root/）不能当文件传给 node，需要排除。
 */
export function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}
	return { command: "pi", args };
}

/** 有上限的流累积器：达到上限后停止累积，只记截断标记。 */
class CappedBuffer {
	private chunks: string[] = [];
	private size = 0;
	private readonly cap: number;
	truncated = false;

	constructor(cap: number) {
		this.cap = cap;
	}

	push(text: string): void {
		if (this.truncated) {
			return;
		}
		const room = this.cap - this.size;
		if (text.length >= room) {
			this.chunks.push(text.slice(0, Math.max(0, room)));
			this.size = this.cap;
			this.truncated = true;
			return;
		}
		this.chunks.push(text);
		this.size += text.length;
	}

	toString(): string {
		return this.chunks.join("");
	}
}

/**
 * 运行 pi 子进程。永远 resolve，不 reject —— 调用方通过 code / aborted / timedOut 判断。
 */
export function runPiChild(opts: PiChildOptions): Promise<PiChildResult> {
	const cap = opts.maxStreamBytes ?? DEFAULT_MAX_STREAM_BYTES;
	const timeoutMs = opts.timeoutMs ?? DEFAULT_CHILD_TIMEOUT_MS;

	return new Promise<PiChildResult>((resolve) => {
		const invocation = getPiInvocation(opts.args);
		const stdout = new CappedBuffer(cap);
		const stderr = new CappedBuffer(cap);
		let aborted = false;
		let timedOut = false;
		let settled = false;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
		let removeAbortListener: (() => void) | undefined;

		const child = spawn(invocation.command, invocation.args, {
			cwd: opts.cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			env: opts.env ? { ...process.env, ...opts.env } : process.env,
		});

		// 关键：让 Node 处理跨 chunk 的多字节字符边界。
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");

		const finish = (code: number) => {
			if (settled) {
				return;
			}
			settled = true;
			if (killTimer) clearTimeout(killTimer);
			if (timeoutTimer) clearTimeout(timeoutTimer);
			removeAbortListener?.();
			resolve({
				code,
				stdout: stdout.toString(),
				stderr: stderr.toString(),
				aborted,
				timedOut,
				truncated: stdout.truncated || stderr.truncated,
			});
		};

		const kill = () => {
			child.kill("SIGTERM");
			killTimer = setTimeout(() => {
				if (!child.killed) {
					child.kill("SIGKILL");
				}
			}, KILL_GRACE_MS);
		};

		let lineBuffer = "";
		child.stdout.on("data", (text: string) => {
			stdout.push(text);
			if (!opts.onLine) {
				return;
			}
			lineBuffer += text;
			const lines = lineBuffer.split("\n");
			lineBuffer = lines.pop() ?? "";
			for (const line of lines) {
				opts.onLine(line);
			}
		});

		child.stderr.on("data", (text: string) => {
			stderr.push(text);
		});

		child.on("close", (code) => {
			if (lineBuffer.trim() && opts.onLine) {
				opts.onLine(lineBuffer);
			}
			finish(code ?? 0);
		});

		child.on("error", () => {
			finish(1);
		});

		if (timeoutMs > 0) {
			timeoutTimer = setTimeout(() => {
				timedOut = true;
				kill();
			}, timeoutMs);
		}

		if (opts.signal) {
			const onAbort = () => {
				aborted = true;
				kill();
			};
			if (opts.signal.aborted) {
				onAbort();
			} else {
				opts.signal.addEventListener("abort", onAbort, { once: true });
				removeAbortListener = () =>
					opts.signal?.removeEventListener("abort", onAbort);
			}
		}
	});
}
