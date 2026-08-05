import type { Message } from "@earendil-works/pi-ai";

export const DEFAULT_PER_TASK_OUTPUT_CAP = 50 * 1024;

export interface JsonlEvent {
	type: string;
	[key: string]: unknown;
}

export function parseJsonlLine(line: string): JsonlEvent | undefined {
	if (!line.trim()) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(line);
		if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
			return parsed as JsonlEvent;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export function isMessageEndEvent(event: JsonlEvent): event is JsonlEvent & { message: Message } {
	return event.type === "message_end" && isRecord(event.message);
}

export function isToolResultEndEvent(event: JsonlEvent): event is JsonlEvent & { message: Message } {
	return event.type === "tool_result_end" && isRecord(event.message);
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

export function truncateOutput(output: string, cap = DEFAULT_PER_TASK_OUTPUT_CAP): string {
	const byteLength = Buffer.byteLength(output, "utf8");
	if (byteLength <= cap) return output;
	let truncated = output.slice(0, cap);
	while (Buffer.byteLength(truncated, "utf8") > cap) {
		truncated = truncated.slice(0, -1);
	}
	return `${truncated}\n\n[Output truncated: ${byteLength - Buffer.byteLength(truncated, "utf8")} bytes omitted. Full output preserved in tool details.]`;
}

export function formatUsage(usage: {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}, model?: string): string {
	const parts: string[] = [];
	if (usage.turns) parts.push(`${usage.turns} turn${usage.turns > 1 ? "s" : ""}`);
	if (usage.input) parts.push(`↑${usage.input}`);
	if (usage.output) parts.push(`↓${usage.output}`);
	if (usage.cacheRead) parts.push(`R${usage.cacheRead}`);
	if (usage.cacheWrite) parts.push(`W${usage.cacheWrite}`);
	if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
	if (usage.contextTokens) parts.push(`ctx:${usage.contextTokens}`);
	if (model) parts.push(model);
	return parts.join(" ");
}
