/**
 * 原生桌面通知。pi 自己完全没有这个能力（既不发 OSC 9/777/99，也不响铃），
 * 所以这里直接 fork 系统通知命令：Linux `notify-send`、macOS `osascript`。
 *
 * 为什么走 pi.exec 而不是 child_process：pi.exec 收的是 (command, args[])，
 * 不经 shell，通知正文里的引号/反引号/`$(...)` 不可能变成命令。通知正文来自模型
 * 输出和文件路径，是不可信数据，绝不能拼进 shell 字符串。
 *
 * 默认关闭：SSH / 容器里没有通知守护进程，发出去只会每轮白跑一个失败的子进程。
 * 要用的人在 pi-extends.json 里把 notifications.enabled 打开即可。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { NotificationsConfig } from "./config.ts";

/** 通知标题/正文的硬上限。守护进程对超长正文表现各异，截断比赌运气好。 */
const MAX_TITLE = 80;
const MAX_BODY = 240;

/** 发通知的超时。通知守护进程要么立刻返回要么根本不在，等 3 秒足够。 */
const NOTIFY_TIMEOUT_MS = 3000;

/** ANSI CSI/OSC 序列，以及剩下的裸控制字符。用 \u 转义写，不往源码里塞真控制字节。 */
const ANSI_CSI = /\u001b\[[0-9;?]*[ -\/]*[@-~]/g;
const ANSI_OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?/g;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

export type NotifyUrgency = "low" | "normal" | "critical";

export interface NotifyRequest {
	title: string;
	body: string;
	urgency?: NotifyUrgency;
}

/**
 * 清洗单行文本：控制字符会让 notify-send 的参数解析和 osascript 的字符串字面量都出问题，
 * 换行在通知气泡里也没有意义（多数守护进程只显示一两行）。
 */
export function sanitizeLine(text: string, max: number): string {
	const flat = text
		.replace(ANSI_OSC, "")
		.replace(ANSI_CSI, "")
		.replace(CONTROL_CHARS, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (flat.length <= max) {
		return flat;
	}
	// 留一个字符给省略号，避免截断后长度反而是 max+1
	return `${flat.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * 是否值得为这一轮发通知。
 *
 * 判据是「用户大概已经走开了」——只有跑够久的任务才配打断人。onIdle 关掉时
 * 回合结束不发通知（blocker / subagent 这些显式事件不走这里）。
 */
export function shouldNotifyIdle(durationMs: number, config: NotificationsConfig): boolean {
	if (!config.enabled || !config.onIdle) {
		return false;
	}
	if (!Number.isFinite(durationMs) || durationMs < 0) {
		return false;
	}
	return durationMs >= config.minSeconds * 1000;
}

/** 平台对应的通知命令。返回 null 表示这个平台没有已知的命令，静默跳过。 */
export function notifyCommand(
	req: NotifyRequest,
	platform: string = process.platform,
): { command: string; args: string[] } | null {
	const title = sanitizeLine(req.title, MAX_TITLE) || "pi";
	const body = sanitizeLine(req.body, MAX_BODY);
	if (platform === "darwin") {
		// osascript 的字符串字面量里只有 \ 和 " 需要转义；控制字符已在 sanitizeLine 剥掉。
		const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		return {
			command: "osascript",
			args: ["-e", `display notification "${esc(body)}" with title "${esc(title)}"`],
		};
	}
	if (platform === "linux" || platform === "freebsd" || platform === "openbsd") {
		return {
			command: "notify-send",
			args: [
				"--app-name=pi",
				`--urgency=${req.urgency ?? "normal"}`,
				// 正文可能以 - 开头（比如某个 flag 名），用 -- 终止选项解析
				"--",
				title,
				body,
			],
		};
	}
	return null;
}

/**
 * 记住通知命令是不是压根不存在。第一次 ENOENT 之后就别再 fork 了——
 * 没装 notify-send 的机器上，每轮失败一次子进程纯属浪费。
 */
let notifyUnavailable = false;

/** 仅供测试重置探测缓存。 */
export function resetNotifyAvailability(): void {
	notifyUnavailable = false;
}

/**
 * 尽力发一条通知。永不抛错：通知失败不该影响任何一次回合或子代理。
 */
export async function sendNotification(pi: ExtensionAPI, req: NotifyRequest): Promise<void> {
	if (notifyUnavailable) {
		return;
	}
	const cmd = notifyCommand(req);
	if (!cmd) {
		notifyUnavailable = true;
		return;
	}
	try {
		const r = await pi.exec(cmd.command, cmd.args, { timeout: NOTIFY_TIMEOUT_MS });
		// 127 = shell 找不到命令，之后不必再试
		if (r.code === 127) {
			notifyUnavailable = true;
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.includes("ENOENT") || msg.includes("not found")) {
			notifyUnavailable = true;
		}
	}
}

/** 把毫秒说成人话，用在通知正文里。 */
export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.round(ms / 1000));
	if (total < 60) {
		return `${total}s`;
	}
	const m = Math.floor(total / 60);
	const s = total % 60;
	if (m < 60) {
		return s === 0 ? `${m}m` : `${m}m${s}s`;
	}
	const h = Math.floor(m / 60);
	return `${h}h${m % 60}m`;
}
