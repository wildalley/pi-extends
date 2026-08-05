import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { isPlanModeActive } from "./plan-mode.ts";
import { getConfig } from "./store.ts";

export type GoalStatus = "inactive" | "active" | "paused" | "blocked" | "completed" | "cancelled";
export type GoalStrategy = "focused" | "autopilot";

export interface GoalState {
	text: string;
	status: GoalStatus;
	strategy: GoalStrategy;
	turnsUsed: number;
	maxTurns: number;
	progress: string;
	summary?: string;
	blockedReason?: string;
}

const GOAL_CONTEXT_TYPE = "goal-mode-context";

function inactiveState(maxTurns: number): GoalState {
	return {
		text: "",
		status: "inactive",
		strategy: "focused",
		turnsUsed: 0,
		maxTurns,
		progress: "",
	};
}

let state: GoalState = inactiveState(5);

export function getGoalState(): GoalState {
	return { ...state };
}

const GoalParams = Type.Object({
	action: Type.String({ description: "status | update | complete | block", enum: ["status", "update", "complete", "block"] }),
	progress: Type.Optional(Type.String({ description: "update：最新进度说明" })),
	summary: Type.Optional(Type.String({ description: "complete：完成摘要" })),
	reason: Type.Optional(Type.String({ description: "block：阻塞原因" })),
});

type GoalParams = Static<typeof GoalParams>;

function persist(pi: ExtensionAPI): void {
	pi.appendEntry("goal-mode", state);
}

function describe(state: GoalState): string {
	const lines = [
		`目标: ${state.text || "(无)"}`,
		`状态: ${state.status}`,
		`策略: ${state.strategy}`,
		`轮次: ${state.turnsUsed}/${state.maxTurns}`,
	];
	if (state.progress) lines.push(`进度: ${state.progress}`);
	if (state.summary) lines.push(`完成摘要: ${state.summary}`);
	if (state.blockedReason) lines.push(`阻塞原因: ${state.blockedReason}`);
	return lines.join("\n");
}

function statusText(): string {
	return describe(state);
}

function updateProgress(pi: ExtensionAPI, progress: string): string {
	if (state.status !== "active" && state.status !== "paused") {
		return `Goal 当前状态为 ${state.status}，无法更新进度。`;
	}
	state.progress = progress;
	persist(pi);
	return `进度已更新：${progress}`;
}

function complete(pi: ExtensionAPI, summary: string): string {
	if (state.status === "inactive") {
		return "没有进行中的 Goal。";
	}
	state.status = "completed";
	state.summary = summary;
	state.progress = "";
	persist(pi);
	return `Goal 已完成。${summary}`;
}

function block(pi: ExtensionAPI, reason: string): string {
	if (state.status !== "active") {
		return `Goal 当前状态为 ${state.status}，无法阻塞。`;
	}
	state.status = "blocked";
	state.blockedReason = reason;
	persist(pi);
	return `Goal 已标记为阻塞：${reason}`;
}

function startGoal(pi: ExtensionAPI, ctx: ExtensionContext, text: string, strategy: GoalStrategy): void {
	if (!text.trim()) {
		ctx.ui.notify("Goal 文本不能为空。", "warning");
		return;
	}
	const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
	state = {
		text: text.trim(),
		status: "active",
		strategy,
		turnsUsed: 0,
		maxTurns: config.goal.maxAutoTurns,
		progress: "",
	};
	persist(pi);
	ctx.ui.notify(`Goal 已开始（${strategy}，最多 ${state.maxTurns} 轮）。`);
}

function pauseGoal(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (state.status !== "active") {
		ctx.ui.notify(`Goal 当前状态为 ${state.status}，无法暂停。`, "warning");
		return;
	}
	state.status = "paused";
	persist(pi);
	ctx.ui.notify("Goal 已暂停。");
}

function resumeGoal(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (state.status !== "paused" && state.status !== "blocked") {
		ctx.ui.notify(`Goal 当前状态为 ${state.status}，无法恢复。`, "warning");
		return;
	}
	state.status = "active";
	persist(pi);
	ctx.ui.notify("Goal 已恢复。");
}

function clearGoal(pi: ExtensionAPI, ctx: ExtensionContext): void {
	state = inactiveState(state.maxTurns);
	persist(pi);
	ctx.ui.notify("Goal 已清除。");
}

export async function runGoalCommand(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	args: string,
): Promise<void> {
	const parts = args.trim().split(/\s+/);
	const action = parts[0] ?? "";
	if (action === "start") {
		const rest = parts.slice(1).join(" ").trim();
		const isAuto = rest.endsWith(" --autopilot");
		const text = isAuto ? rest.slice(0, rest.length - "--autopilot".length).trim() : rest;
		startGoal(pi, ctx, text, isAuto ? "autopilot" : "focused");
	} else if (action === "status") {
		ctx.ui.notify(statusText(), "info");
	} else if (action === "pause") {
		pauseGoal(pi, ctx);
	} else if (action === "resume") {
		resumeGoal(pi, ctx);
	} else if (action === "complete") {
		const summary = parts.slice(1).join(" ").trim();
		if (state.status === "inactive") {
			ctx.ui.notify("没有进行中的 Goal。", "warning");
			return;
		}
		complete(pi, summary);
		ctx.ui.notify("Goal 已完成。", "info");
	} else if (action === "clear") {
		clearGoal(pi, ctx);
	} else {
		ctx.ui.notify("用法: /goal start <文本> [--autopilot] | status | pause | resume | complete [摘要] | clear", "info");
	}
}

export default function goalModeExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "goal",
		label: "Goal",
		description: [
			"管理当前 Goal 目标状态。",
			"action=status 查询；action=update 更新最新进度；action=complete 标记完成并附摘要；action=block 标记阻塞并附原因。",
		].join(" "),
		parameters: GoalParams,
		async execute(_toolCallId, params) {
			switch (params.action) {
				case "status":
					return { content: [{ type: "text", text: statusText() }], details: { state } };
				case "update":
					return { content: [{ type: "text", text: updateProgress(pi, params.progress ?? "") }], details: { state } };
				case "complete":
					return { content: [{ type: "text", text: complete(pi, params.summary ?? "") }], details: { state } };
				case "block":
					return { content: [{ type: "text", text: block(pi, params.reason ?? "") }], details: { state } };
				default:
					return { content: [{ type: "text", text: statusText() }], details: { state } };
			}
		},
	});

	pi.registerCommand("goal", {
		description: "Goal 模式：start/status/pause/resume/complete/clear",
		handler: async (args, ctx) => {
			await runGoalCommand(pi, ctx, args);
		},
	});

	pi.on("before_agent_start", async () => {
		if (state.status !== "active") {
			return;
		}
		const goalBlock = `[GOAL ACTIVE]
目标: ${state.text}
策略: ${state.strategy}
进度: ${state.progress || "(尚未开始)"}
已用轮次: ${state.turnsUsed}/${state.maxTurns}

${state.strategy === "autopilot" ? "每轮结束后会自动继续推进。完成后调用 goal 工具 complete。" : "仅在你发起的新一轮次中保持目标；完成后调用 goal 工具 complete。"}`;
		return {
			message: { customType: GOAL_CONTEXT_TYPE, content: goalBlock, display: false },
		};
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (state.status !== "active" || state.strategy !== "autopilot") {
			return;
		}
		if (isPlanModeActive()) {
			state.progress = "等待计划批准，autopilot 暂停自动推进。";
			persist(pi);
			return;
		}
		if (ctx.hasPendingMessages()) {
			state.progress = "有待处理消息，autopilot 暂停自动推进。";
			persist(pi);
			return;
		}
		if (state.turnsUsed >= state.maxTurns) {
			state.status = "paused";
			state.progress = `已达到轮次上限（${state.maxTurns}），自动暂停。`;
			persist(pi);
			ctx.ui.notify("Goal autopilot 已达到轮次上限，已自动暂停。", "warning");
			return;
		}
		state.turnsUsed += 1;
		persist(pi);
		pi.sendUserMessage(
			`继续推进目标：${state.text}\n最新进度：${state.progress || "(尚未开始)"}\n本轮次：${state.turnsUsed}/${state.maxTurns}`,
			{ deliverAs: "followUp" },
		);
	});

	pi.on("turn_end", async (event, ctx) => {
		if (state.status !== "active" || state.strategy !== "autopilot") {
			return;
		}
		if (event.message.role === "assistant" && event.message.stopReason === "aborted") {
			state.status = "paused";
			state.progress = "用户中止了当前轮次，autopilot 已暂停。";
			persist(pi);
			ctx.ui.notify("用户中止，Goal autopilot 已暂停。", "info");
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		state = inactiveState(config.goal.maxAutoTurns);
		const entries = ctx.sessionManager.getEntries();
		const goalEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "goal-mode")
			.pop() as { data?: GoalState } | undefined;
		if (goalEntry?.data) {
			state = { ...inactiveState(config.goal.maxAutoTurns), ...goalEntry.data };
		}
	});
}
