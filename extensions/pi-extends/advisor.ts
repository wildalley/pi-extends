/**
 * Advisor 旁审：每轮结束后，让第二个模型在自己的上下文里只读复查刚才的一来一回，
 * 把值得注意的地方作为卡片贴回转录区。
 *
 * 设计取舍：
 * - 走子进程（和 subagent 同一套 pi 调用），而不是复用当前会话 —— 旁审必须有独立上下文，
 *   否则它会被主线的措辞带着走。
 * - 子进程带 `-ne`（不加载扩展）并设环境变量兜底，避免 Advisor 递归拉起 Advisor。
 * - 只给只读工具，且 `sendMessage({ triggerTurn: false })`，旁审永远不会替用户发起新一轮。
 */

import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Component } from "@earendil-works/pi-tui";
import { type AdvisorSeverity, type PiExtendsConfig } from "./config.ts";
import {
	filterNotes,
	parseAdvisorOutput,
	renderNotes,
	summarizeNotes,
	type AdvisorNote,
} from "./advisor-parse.ts";
import { editConfig } from "./config-ui.ts";
import { sendNotification } from "./notify.ts";
import { runPiChild } from "./pi-child.ts";
import { formatRouteDiagnostics, inventoryFromContext, resolveRuntimeRoute } from "./route-runtime.ts";
import { getConfig } from "./store.ts";

const CUSTOM_TYPE = "pi-extends-advisor";
const NESTED_ENV = "PI_EXTENDS_ADVISOR_CHILD";
const TIMEOUT_MS = 120_000;
const MAX_EXCERPT = 6000;
const READONLY_TOOLS = "read,grep,find,ls";

const SYSTEM_PROMPT = `你是 Advisor：独立的第二意见，只读复查。

你会看到主对话里刚刚发生的一轮（用户请求 + 助手回答/改动摘要）。
你的任务不是重做工作，而是指出主线可能忽略的东西：错误的假设、遗漏的边界情况、
风险与副作用、更简单的做法、缺失的验证。没什么可说的就直接输出 none。

严格按下面的格式输出，每条一行，不要写别的内容：
<aside|concern|blocker> :: 标题 :: 一句话说明
等级含义：aside=顺便一提，concern=值得处理，blocker=继续下去很可能出问题。
最多三条，只留真正有价值的。什么都没有就只输出：none`;

interface AdvisorState {
	enabled: boolean | undefined;
	shown: number;
	running: boolean;
}

const state: AdvisorState = { enabled: undefined, shown: 0, running: false };
let sessionGeneration = 0;

/** 会话切换时清理临时覆盖，并让尚未结束的旧旁审结果失效。 */
export function resetAdvisorSession(): void {
	sessionGeneration++;
	state.enabled = undefined;
	state.shown = 0;
	state.running = false;
}

export const advisorController = {
	isEnabled(config: PiExtendsConfig): boolean {
		return state.enabled ?? config.advisor.enabled;
	},
	shown(): number {
		return state.shown;
	},
	setEnabled(enabled: boolean): void {
		state.enabled = enabled;
	},
};

/** 供 cockpit 使用：持久化开关，同时立刻生效。 */
export async function setAdvisorEnabled(
	ctx: ExtensionContext,
	enabled: boolean,
): Promise<void> {
	advisorController.setEnabled(enabled);
	await editConfig(
		ctx,
		(config) => {
			config.advisor.enabled = enabled;
		},
		{ touched: ["advisor"] },
	);
}

export async function setAdvisorSeverity(
	ctx: ExtensionContext,
	minSeverity: AdvisorSeverity,
): Promise<void> {
	await editConfig(
		ctx,
		(config) => {
			config.advisor.minSeverity = minSeverity;
		},
		{ touched: ["advisor"] },
	);
}

function textOf(message: AgentMessage | undefined): string {
	if (!message || !("content" in message)) {
		return "";
	}
	const content = message.content;
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	return content
		.filter((part): part is { type: "text"; text: string } => part?.type === "text")
		.map((part) => part.text)
		.join("\n");
}

/** 取最后一次「用户说了什么 → 助手做了什么」，这是旁审唯一需要的输入。 */
export function buildExcerpt(messages: AgentMessage[]): string {
	const lastUser = [...messages].reverse().find((m) => m.role === "user");
	const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
	const user = textOf(lastUser).trim();
	const assistant = textOf(lastAssistant).trim();
	if (assistant === "") {
		return "";
	}
	const excerpt = `## 用户请求\n${user || "(无文本内容)"}\n\n## 助手回答\n${assistant}`;
	return excerpt.length > MAX_EXCERPT
		? `${excerpt.slice(0, MAX_EXCERPT)}\n…（已截断）`
		: excerpt;
}

async function runAdvisor(
	ctx: ExtensionContext,
	config: PiExtendsConfig,
	excerpt: string,
	signal: AbortSignal | undefined,
): Promise<AdvisorNote[]> {
	const route = resolveRuntimeRoute(config, "advisor", inventoryFromContext(ctx));
	const diagnostics = formatRouteDiagnostics(route);
	if (!route.model || !route.modelId) {
		ctx.ui.notify(
			`Advisor 路由不可用：${diagnostics || "没有找到已认证模型"}`,
			"warning",
		);
		return [];
	}
	if (diagnostics) {
		ctx.ui.notify(`Advisor 路由已降级：advisor → ${route.modelId}；跳过 ${diagnostics}`, "warning");
	}
	// 递归防护通过子进程 env 传递，而不是改 process.env —— 后者是进程全局状态，
	// 并行的子代理会互相覆盖，且 finally 里的恢复会和其他 in-flight 子进程打架。
	const result = await runPiChild({
		args: [
			"-p",
			"--no-session",
			"-ne",
			"--model",
			route.modelId,
			"--thinking",
			route.thinking,
			"--tools",
			READONLY_TOOLS,
			"--append-system-prompt",
			SYSTEM_PROMPT,
			`复查下面这一轮：\n\n${excerpt}`,
		],
		cwd: ctx.cwd,
		signal,
		timeoutMs: TIMEOUT_MS,
		env: { [NESTED_ENV]: "1" },
	});
	if (result.code !== 0) {
		return [];
	}
	return parseAdvisorOutput(result.stdout);
}

/** 转录区里的旁审卡片：宽度由 TUI 在渲染时给出，所以排版必须延迟到 render。 */
class AdvisorCard implements Component {
	private readonly theme: Theme;
	private readonly notes: AdvisorNote[];

	constructor(theme: Theme, notes: AdvisorNote[]) {
		this.theme = theme;
		this.notes = notes;
	}

	render(width: number): string[] {
		return renderNotes(this.theme, this.notes, width).split("\n");
	}

	invalidate(): void {
		/* 内容是静态的，没有需要丢弃的缓存 */
	}
}

export function registerAdvisor(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<{ notes: AdvisorNote[] }>(CUSTOM_TYPE, (message, _options, theme) => {
		const notes = message.details?.notes ?? [];
		if (notes.length === 0) {
			return undefined;
		}
		return new AdvisorCard(theme, notes);
	});

	pi.on("agent_end", async (event, ctx) => {
		if (process.env[NESTED_ENV] === "1" || state.running) {
			return;
		}
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		if (!advisorController.isEnabled(config)) {
			return;
		}
		if (state.shown >= config.advisor.maxPerSession) {
			return;
		}
		const excerpt = buildExcerpt(event.messages);
		if (excerpt === "") {
			return;
		}
		const runGeneration = sessionGeneration;
		state.running = true;
		try {
			const notes = filterNotes(
				await runAdvisor(ctx, config, excerpt, undefined),
				config.advisor.minSeverity,
			);
			if (runGeneration !== sessionGeneration) {
				return;
			}
			if (notes.length === 0) {
				return;
			}
			state.shown += notes.length;
			// blocker 是「别继续了」，值得把人从别的窗口叫回来；concern/aside 不打断。
			const blockers = notes.filter((n) => n.severity === "blocker");
			if (blockers.length > 0 && config.notifications.enabled && config.notifications.onAdvisorBlocker) {
				void sendNotification(pi, {
					title: `Advisor 阻塞 ×${blockers.length}`,
					body: blockers[0].title,
					urgency: "critical",
				});
			}
			if (ctx.hasUI) {
				pi.sendMessage(
					{
						customType: CUSTOM_TYPE,
						content: `Advisor 旁审：\n${summarizeNotes(notes)}`,
						display: true,
						details: { notes },
					},
					{ triggerTurn: false },
				);
			} else {
				ctx.ui.notify(summarizeNotes(notes), "info");
			}
		} finally {
			if (runGeneration === sessionGeneration) {
				state.running = false;
			}
		}
	});

	pi.on("session_start", () => {
		resetAdvisorSession();
	});
}
