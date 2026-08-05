import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./plan-utils.ts";

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);

interface PlanModeState {
	enabled: boolean;
	todos?: TodoItem[];
	executing?: boolean;
	toolsBeforePlanMode?: string[];
}

let planModeEnabled = false;
let executionMode = false;
let todoItems: TodoItem[] = [];
let toolsBeforePlanMode: string[] | undefined;

export function isPlanModeActive(): boolean {
	return planModeEnabled;
}

export function isPlanExecuting(): boolean {
	return executionMode && todoItems.length > 0;
}

export interface PlanController {
	enable(ctx: ExtensionContext): void;
	disable(ctx: ExtensionContext): void;
	status(ctx: ExtensionContext): void;
	execute(ctx: ExtensionContext): void;
}

export const planController: Partial<PlanController> = {};

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function uniqueToolNames(toolNames: string[]): string[] {
	return [...new Set(toolNames)];
}

function getPlanModeTools(activeToolNames: string[]): string[] {
	return uniqueToolNames([
		...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
		...PLAN_MODE_TOOLS,
	]);
}

function getNormalModeTools(activeToolNames: string[]): string[] {
	return uniqueToolNames([
		...NORMAL_MODE_TOOLS,
		...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
	]);
}

function updateStatus(ctx: ExtensionContext): void {
	if (executionMode && todoItems.length > 0) {
		const completed = todoItems.filter((t) => t.completed).length;
		ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`));
	} else if (planModeEnabled) {
		ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
	} else {
		ctx.ui.setStatus("plan-mode", undefined);
	}

	if (executionMode && todoItems.length > 0) {
		const lines = todoItems.map((item) => {
			if (item.completed) {
				return ctx.ui.theme.fg("success", "☑ ") + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text));
			}
			return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
		});
		ctx.ui.setWidget("plan-todos", lines);
	} else {
		ctx.ui.setWidget("plan-todos", undefined);
	}
}

function persistState(pi: ExtensionAPI): void {
	pi.appendEntry("plan-mode", {
		enabled: planModeEnabled,
		todos: todoItems,
		executing: executionMode,
		toolsBeforePlanMode,
	} satisfies PlanModeState);
}

function enablePlanModeTools(pi: ExtensionAPI): void {
	if (toolsBeforePlanMode === undefined) {
		toolsBeforePlanMode = pi.getActiveTools();
	}
	pi.setActiveTools(getPlanModeTools(toolsBeforePlanMode));
}

function restoreNormalModeTools(pi: ExtensionAPI): void {
	pi.setActiveTools(toolsBeforePlanMode ?? getNormalModeTools(pi.getActiveTools()));
	toolsBeforePlanMode = undefined;
}

function enablePlanMode(pi: ExtensionAPI, ctx: ExtensionContext): void {
	planModeEnabled = true;
	executionMode = false;
	todoItems = [];
	enablePlanModeTools(pi);
	ctx.ui.notify("Plan 模式已启用：编辑与写入工具已禁用。");
	updateStatus(ctx);
	persistState(pi);
}

function disablePlanMode(pi: ExtensionAPI, ctx: ExtensionContext): void {
	planModeEnabled = false;
	executionMode = false;
	todoItems = [];
	restoreNormalModeTools(pi);
	ctx.ui.notify("Plan 模式已禁用，完整权限已恢复。");
	updateStatus(ctx);
	persistState(pi);
}

function showPlanStatus(ctx: ExtensionContext): void {
	if (planModeEnabled) {
		const items = todoItems.map((t) => `${t.step}. ${t.completed ? "✓" : "○"} ${t.text}`).join("\n");
		ctx.ui.notify(`Plan 模式：已启用${executionMode ? "（执行中）" : ""}\n${items || "尚无计划"}`, "info");
	} else {
		ctx.ui.notify("Plan 模式：未启用（/plan on）", "info");
	}
}

function startExecution(pi: ExtensionAPI, ctx: ExtensionContext): void {
	if (todoItems.length === 0) {
		ctx.ui.notify("没有可执行的计划。先让模型在 Plan 模式下产出计划。", "warning");
		return;
	}
	const firstTodoItem = todoItems[0];
	if (!firstTodoItem) return;
	planModeEnabled = false;
	executionMode = true;
	restoreNormalModeTools(pi);
	updateStatus(ctx);
	persistState(pi);

	const remainingList = todoItems.map((t) => `${t.step}. ${t.text}`).join("\n");
	const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
	pi.sendMessage(
		{ customType: "plan-todo-list", content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`, display: true },
		{ deliverAs: "followUp" },
	);
	pi.sendMessage(
		{
			customType: "plan-mode-execute",
			content: `执行计划。

剩余步骤：
${remainingList}

从第 1 步开始：${firstTodoItem.text}
每完成一步，在回答中包含 [DONE:n] 标记。`,
			display: true,
		},
		{ triggerTurn: true, deliverAs: "followUp" },
	);
}

export default function planModeExtension(pi: ExtensionAPI): void {
	planController.enable = (ctx) => enablePlanMode(pi, ctx);
	planController.disable = (ctx) => disablePlanMode(pi, ctx);
	planController.status = (ctx) => showPlanStatus(ctx);
	planController.execute = (ctx) => startExecution(pi, ctx);

	function dispatchPlanCommand(ctx: ExtensionCommandContext, args: string): void {
		const action = args.trim().split(/\s+/)[0] ?? "";
		if (action === "on") {
			enablePlanMode(pi, ctx);
		} else if (action === "off") {
			disablePlanMode(pi, ctx);
		} else if (action === "status") {
			showPlanStatus(ctx);
		} else if (action === "execute") {
			startExecution(pi, ctx);
		} else if (action === "") {
			if (planModeEnabled) {
				disablePlanMode(pi, ctx);
			} else {
				enablePlanMode(pi, ctx);
			}
		} else {
			ctx.ui.notify("用法: /plan [on|off|status|execute]", "info");
		}
	}

	pi.registerFlag("plan", {
		description: "以 Plan 模式（只读探索）启动",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("plan", {
		description: "Plan 模式：on/off/status/execute",
		handler: async (args, ctx) => {
			dispatchPlanCommand(ctx, args);
		},
	});

	pi.registerCommand("todos", {
		description: "显示当前计划步骤",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("没有计划步骤。先用 /plan on 产出计划。", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`).join("\n");
			ctx.ui.notify(`计划进度：\n${list}`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "切换 Plan 模式",
		handler: async (ctx) => {
			if (planModeEnabled) {
				disablePlanMode(pi, ctx);
			} else {
				enablePlanMode(pi, ctx);
			}
		},
	});

	pi.on("tool_call", async (event) => {
		if (!planModeEnabled || event.toolName !== "bash") return;
		const command = event.input.command as string;
		if (!isSafeCommand(command)) {
			return {
				block: true,
				reason: `Plan mode: command blocked (not allowlisted). Use /plan off to disable plan mode first.\nCommand: ${command}`,
			};
		}
	});

	pi.on("context", async (event) => {
		if (planModeEnabled) return;
		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				if (msg.customType === "plan-mode-context") return false;
				if (msg.role !== "user") return true;
				const content = msg.content;
				if (typeof content === "string") {
					return !content.includes("[PLAN MODE ACTIVE]");
				}
				if (Array.isArray(content)) {
					return !content.some(
						(c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
					);
				}
				return true;
			}),
		};
	});

	pi.on("before_agent_start", async () => {
		if (planModeEnabled) {
			return {
				message: {
					customType: "plan-mode-context",
					content: `[PLAN MODE ACTIVE]
You are in plan mode - a read-only exploration mode for safe code analysis.

Restrictions:
- Built-in edit and write tools are disabled
- Other currently active tools remain available
- Bash is restricted to an allowlist of read-only commands

Create a detailed numbered plan under a "Plan:" header:

Plan:
1. First step description
2. Second step description
...

Do NOT attempt to make changes - just describe what you would do.`,
					display: false,
				},
			};
		}

		if (executionMode && todoItems.length > 0) {
			const remaining = todoItems.filter((t) => !t.completed);
			const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
			return {
				message: {
					customType: "plan-execution-context",
					content: `[EXECUTING PLAN - Full tool access enabled]

Remaining steps:
${todoList}

Execute each step in order.
After completing a step, include a [DONE:n] tag in your response.`,
					display: false,
				},
			};
		}
	});

	pi.on("turn_end", async (event, ctx) => {
		if (!executionMode || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;
		const text = getTextContent(event.message);
		if (markCompletedSteps(text, todoItems) > 0) {
			updateStatus(ctx);
		}
		persistState(pi);
	});

	pi.on("agent_end", async (event, ctx) => {
		if (executionMode && todoItems.length > 0) {
			if (todoItems.every((t) => t.completed)) {
				const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
				pi.sendMessage(
					{ customType: "plan-complete", content: `**Plan Complete!** ✓\n\n${completedList}`, display: true },
					{ triggerTurn: false },
				);
				executionMode = false;
				todoItems = [];
				updateStatus(ctx);
				persistState(pi);
			}
			return;
		}

		if (!planModeEnabled || !ctx.hasUI) return;

		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (lastAssistant) {
			const extracted = extractTodoItems(getTextContent(lastAssistant));
			if (extracted.length > 0) {
				todoItems = extracted;
			}
		}
		if (todoItems.length === 0) return;
		persistState(pi);

		const todoListText = todoItems.map((t, i) => `${i + 1}. ☐ ${t.text}`).join("\n");
		const planTodoListMessage = {
			customType: "plan-todo-list",
			content: `**Plan Steps (${todoItems.length}):**\n\n${todoListText}`,
			display: true,
		};

		const choice = await ctx.ui.select("Plan 模式 - 接下来做什么？", [
			"执行计划（跟踪进度）",
			"继续规划",
			"修改计划",
		]);
		if (choice?.startsWith("执行计划")) {
			startExecution(pi, ctx);
		} else if (choice === "修改计划") {
			const refinement = await ctx.ui.editor("修改计划：", "");
			if (refinement?.trim()) {
				pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		const entries = ctx.sessionManager.getEntries();
		const planModeEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "plan-mode")
			.pop() as { data?: PlanModeState } | undefined;

		if (planModeEntry?.data) {
			planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
			todoItems = planModeEntry.data.todos ?? todoItems;
			executionMode = planModeEntry.data.executing ?? executionMode;
			toolsBeforePlanMode = planModeEntry.data.toolsBeforePlanMode ?? toolsBeforePlanMode;
		}

		const isResume = planModeEntry !== undefined;
		if (isResume && executionMode && todoItems.length > 0) {
			let executeIndex = -1;
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i] as { type: string; customType?: string };
				if (entry.customType === "plan-mode-execute") {
					executeIndex = i;
					break;
				}
			}
			const messages: AssistantMessage[] = [];
			for (let i = executeIndex + 1; i < entries.length; i++) {
				const entry = entries[i];
				if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
					messages.push(entry.message as AssistantMessage);
				}
			}
			const allText = messages.map(getTextContent).join("\n");
			markCompletedSteps(allText, todoItems);
		}

		if (planModeEnabled) {
			enablePlanModeTools(pi);
		}
		updateStatus(ctx);
	});
}
