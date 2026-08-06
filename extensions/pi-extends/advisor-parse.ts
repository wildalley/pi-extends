/**
 * Advisor 旁审的解析与渲染。
 *
 * 单独成模块：解析和排版是纯函数，可以直接测；真正拉起子进程的部分在 advisor.ts。
 */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { ADVISOR_SEVERITIES, type AdvisorSeverity } from "./config.ts";
import { wrapText } from "./ui-kit.ts";

export interface AdvisorNote {
	severity: AdvisorSeverity;
	title: string;
	body: string;
}

const SEVERITY_RANK: Record<AdvisorSeverity, number> = {
	aside: 0,
	concern: 1,
	blocker: 2,
};

export const SEVERITY_ICONS: Record<AdvisorSeverity, string> = {
	aside: "◇",
	concern: "▲",
	blocker: "■",
};

export const SEVERITY_LABELS: Record<AdvisorSeverity, string> = {
	aside: "旁注",
	concern: "疑虑",
	blocker: "阻塞",
};

const MAX_TITLE = 120;
const MAX_BODY = 600;

/** Advisor 子进程被要求输出的行格式。 */
const NOTE_LINE = new RegExp(
	`^\\s*(?:[-*]\\s*)?(${ADVISOR_SEVERITIES.join("|")})\\s*::\\s*(.+?)(?:\\s*::\\s*(.*))?$`,
	"i",
);

function clamp(text: string, max: number): string {
	const trimmed = text.trim();
	return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * 解析 Advisor 输出。每条意见一行：`severity :: 标题 :: 正文`，
 * 缩进的后续行接到上一条正文里。无法识别的行（寒暄、`none`）全部丢掉，
 * 所以模型多说几句也不会污染卡片。
 */
export function parseAdvisorOutput(text: string): AdvisorNote[] {
	const notes: AdvisorNote[] = [];
	for (const line of text.split("\n")) {
		const match = NOTE_LINE.exec(line);
		if (match) {
			const severity = match[1]?.toLowerCase() as AdvisorSeverity;
			const title = clamp(match[2] ?? "", MAX_TITLE);
			if (title === "") {
				continue;
			}
			notes.push({ severity, title, body: clamp(match[3] ?? "", MAX_BODY) });
			continue;
		}
		const last = notes[notes.length - 1];
		if (last && /^\s+\S/.test(line)) {
			last.body = clamp(`${last.body} ${line.trim()}`, MAX_BODY);
		}
	}
	return notes;
}

/** 过滤低于阈值的意见，并按严重程度从高到低排序。 */
export function filterNotes(notes: AdvisorNote[], min: AdvisorSeverity): AdvisorNote[] {
	return notes
		.filter((n) => SEVERITY_RANK[n.severity] >= SEVERITY_RANK[min])
		.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
}

function severityTone(severity: AdvisorSeverity): "dim" | "warning" | "error" {
	return severity === "blocker" ? "error" : severity === "concern" ? "warning" : "dim";
}

/**
 * 把意见排成转录区里的无边框卡片：一行标题（图标 + 等级 + 标题），正文缩进换行。
 * 与控制台同一套视觉语言，不画方框。
 */
export function renderNotes(theme: Theme, notes: AdvisorNote[], width: number): string {
	const inner = Math.max(20, Math.min(width, 96) - 4);
	const out: string[] = [];
	for (const note of notes) {
		const tone = severityTone(note.severity);
		out.push(
			`  ${theme.fg(tone, SEVERITY_ICONS[note.severity])} ${theme.fg(tone, SEVERITY_LABELS[note.severity])}  ${theme.bold(theme.fg("text", note.title))}`,
		);
		for (const line of wrapText(note.body, inner)) {
			if (line !== "") {
				out.push(`    ${theme.fg("dim", line)}`);
			}
		}
		out.push("");
	}
	if (out.length > 0) {
		out.pop();
	}
	return out.join("\n");
}

/** 纯文本摘要，给非 TUI 模式和通知用。 */
export function summarizeNotes(notes: AdvisorNote[]): string {
	return notes.map((n) => `[${n.severity}] ${n.title}${n.body ? ` — ${n.body}` : ""}`).join("\n");
}
