import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";
import type { ThinkingLevel } from "./config.ts";
import { icon } from "./icons.ts";
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./plan-utils.ts";
import { formatRouteDiagnostics, fullModelId, inventoryFromContext, resolveRuntimeRoute } from "./route-runtime.ts";
import { getConfig } from "./store.ts";

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
/**
 * 扩展工具没有统一的只读能力声明，Plan 模式不能根据名字猜安全性。
 * 这里只保留本扩展自己能审计的工具：subagent 会再次检查角色的实际工具集，
 * goal 只写 session entry。其他未知工具默认关闭，退出 Plan 后由快照精确恢复。
 */
const PLAN_MODE_ALLOWED_EXTENSION_TOOLS = new Set(["subagent", "goal"]);
/**
 * Plan 模式下被摘掉的工具。导出是给子代理那条路复用的：
 * 「plan 模式禁什么」只能有一份定义，否则改了这里忘了那里，
 * 两条路对「只读」的理解就会悄悄分叉。
 */
export const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);

interface PlanModeState {
	enabled: boolean;
	todos?: TodoItem[];
	executing?: boolean;
	toolsBeforePlanMode?: string[];
}

interface PlanRouteRestore {
	previousModel: Model<any>;
	previousThinking: ThinkingLevel;
	switchedModel: Model<any>;
}

let planModeEnabled = false;
let executionMode = false;
let todoItems: TodoItem[] = [];
let toolsBeforePlanMode: string[] | undefined;
let planRouteRestore: PlanRouteRestore | undefined;

export function isPlanModeActive(): boolean {
	return planModeEnabled;
}

export function isPlanExecuting(): boolean {
	return executionMode && todoItems.length > 0;
}

export interface PlanController {
	enable(ctx: ExtensionContext): Promise<void>;
	disable(ctx: ExtensionContext): Promise<void>;
	status(ctx: ExtensionContext): void;
	execute(ctx: ExtensionContext): Promise<void>;
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
		...activeToolNames.filter((name) => PLAN_MODE_ALLOWED_EXTENSION_TOOLS.has(name)),
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
		ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `${icon("planMode")} ${completed}/${todoItems.length}`));
	} else if (planModeEnabled) {
		ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", `${icon("pause")} plan`));
	} else {
		ctx.ui.setStatus("plan-mode", undefined);
	}

	if (executionMode && todoItems.length > 0) {
		const lines = todoItems.map((item) => {
			if (item.completed) {
				return ctx.ui.theme.fg("success", `${icon("check")} `) + ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text));
			}
			return `${ctx.ui.theme.fg("muted", `${icon("radioOff")} `)}${item.text}`;
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

async function activatePlanRoute(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	// The registry/current model are present in supported Pi versions. Keep this guard so
	// state-machine tests and older hosts can still exercise Plan's tool restrictions.
	if (!ctx.model || !ctx.modelRegistry) return;
	const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
	const resolution = resolveRuntimeRoute(config, "plan", inventoryFromContext(ctx));
	if (!resolution.model || !resolution.modelId) {
		const diagnostics = formatRouteDiagnostics(resolution);
		ctx.ui.notify(`Plan 路由不可用：${diagnostics || "没有找到已认证模型"}`, "warning");
		return;
	}

	const previousModel = ctx.model;
	const previousThinking = pi.getThinkingLevel();
	const alreadySelected = fullModelId(previousModel) === resolution.modelId;
	if (!alreadySelected) {
		const switched = await pi.setModel(resolution.model);
		if (!switched) {
			ctx.ui.notify(`Plan 路由切换失败：${resolution.modelId}`, "warning");
			return;
		}
	}
	planRouteRestore = { previousModel, previousThinking, switchedModel: resolution.model };
	pi.setThinkingLevel(resolution.thinking);
	const diagnostics = formatRouteDiagnostics(resolution);
	ctx.ui.notify(
		`Plan 路由：plan → ${resolution.modelId}${diagnostics ? `；跳过 ${diagnostics}` : ""}`,
		diagnostics ? "warning" : "info",
	);
}

async function restorePlanRoute(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const pending = planRouteRestore;
	planRouteRestore = undefined;
	if (!pending) return;

	if (ctx.model && fullModelId(ctx.model) !== fullModelId(pending.switchedModel)) {
		ctx.ui.notify("Plan 路由结束：检测到模型已被手动切换，跳过自动恢复。", "info");
		return;
	}
	const restored = await pi.setModel(pending.previousModel);
	if (!restored) {
		ctx.ui.notify(`Plan 路由恢复失败，当前仍是 ${fullModelId(pending.switchedModel)}。`, "warning");
		return;
	}
	pi.setThinkingLevel(pending.previousThinking);
	ctx.ui.notify(`Plan 路由结束：已恢复 ${fullModelId(pending.previousModel)}`, "info");
}

async function enablePlanMode(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const wasEnabled = planModeEnabled;
	planModeEnabled = true;
	executionMode = false;
	todoItems = [];
	enablePlanModeTools(pi);
	if (!wasEnabled) await activatePlanRoute(pi, ctx);
	ctx.ui.notify("Plan 模式已启用：写入工具和未审计的扩展工具已禁用。");
	updateStatus(ctx);
	persistState(pi);
}

async function disablePlanMode(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	planModeEnabled = false;
	executionMode = false;
	todoItems = [];
	restoreNormalModeTools(pi);
	await restorePlanRoute(pi, ctx);
	ctx.ui.notify("Plan 模式已禁用，完整权限已恢复。");
	updateStatus(ctx);
	persistState(pi);
}

function showPlanStatus(ctx: ExtensionContext): void {
	if (planModeEnabled) {
		const items = todoItems.map((t) => `${t.step}. ${t.completed ? icon("check") : icon("radioOff")} ${t.text}`).join("\n");
		ctx.ui.notify(`Plan 模式：已启用${executionMode ? "（执行中）" : ""}\n${items || "尚无计划"}`, "info");
	} else {
		ctx.ui.notify("Plan 模式：未启用（/plan on）", "info");
	}
}

async function startExecution(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (todoItems.length === 0) {
		ctx.ui.notify("没有可执行的计划。先让模型在 Plan 模式下产出计划。", "warning");
		return;
	}
	const remainingItems = todoItems.filter((item) => !item.completed);
	if (remainingItems.length === 0) {
		pi.sendMessage(
			{
				customType: "plan-complete",
				content: `**Plan Complete!** ✓\n\n${todoItems.map((t) => `~~${t.text}~~`).join("\n")}`,
				display: true,
			},
			{ triggerTurn: false },
		);
		planModeEnabled = false;
		executionMode = false;
		todoItems = [];
		restoreNormalModeTools(pi);
		await restorePlanRoute(pi, ctx);
		updateStatus(ctx);
		persistState(pi);
		return;
	}
	const firstTodoItem = remainingItems[0];
	if (!firstTodoItem) return;
	planModeEnabled = false;
	executionMode = true;
	restoreNormalModeTools(pi);
	await restorePlanRoute(pi, ctx);
	updateStatus(ctx);
	persistState(pi);

	const remainingList = remainingItems.map((t) => `${t.step}. ${t.text}`).join("\n");
	const todoListText = remainingItems.map((t) => `${t.step}. ☐ ${t.text}`).join("\n");
	pi.sendMessage(
		{ customType: "plan-todo-list", content: `**Plan Steps (${remainingItems.length}):**\n\n${todoListText}`, display: true },
		{ deliverAs: "followUp" },
	);
	pi.sendMessage(
		{
			customType: "plan-mode-execute",
			content: `执行计划。

剩余步骤：
${remainingList}

从第 ${firstTodoItem.step} 步开始：${firstTodoItem.text}
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

	async function dispatchPlanCommand(ctx: ExtensionCommandContext, args: string): Promise<void> {
		const action = args.trim().split(/\s+/)[0] ?? "";
		if (action === "on") {
			await enablePlanMode(pi, ctx);
		} else if (action === "off") {
			await disablePlanMode(pi, ctx);
		} else if (action === "status") {
			showPlanStatus(ctx);
		} else if (action === "execute") {
			await startExecution(pi, ctx);
		} else if (action === "") {
			if (planModeEnabled) {
				await disablePlanMode(pi, ctx);
			} else {
				await enablePlanMode(pi, ctx);
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
			await dispatchPlanCommand(ctx, args);
		},
	});

	pi.registerCommand("todos", {
		description: "显示当前计划步骤",
		handler: async (_args, ctx) => {
			if (todoItems.length === 0) {
				ctx.ui.notify("没有计划步骤。先用 /plan on 产出计划。", "info");
				return;
			}
			const list = todoItems.map((item, i) => `${i + 1}. ${item.completed ? icon("check") : icon("radioOff")} ${item.text}`).join("\n");
			ctx.ui.notify(`计划进度：\n${list}`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlAlt("p"), {
		description: "切换 Plan 模式",
		handler: async (ctx) => {
			if (planModeEnabled) {
				await disablePlanMode(pi, ctx);
			} else {
				await enablePlanMode(pi, ctx);
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
- Only audited extension tools remain available; unknown tools are disabled
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
			await startExecution(pi, ctx);
		} else if (choice === "修改计划") {
			const refinement = await ctx.ui.editor("修改计划：", "");
			if (refinement?.trim()) {
				pi.sendMessage(planTodoListMessage, { deliverAs: "followUp" });
				pi.sendUserMessage(refinement.trim(), { deliverAs: "followUp" });
			}
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		// A route restore belongs to the session in which Plan was entered. Never carry
		// a Model object from an old session into the next one.
		planRouteRestore = undefined;
		if (pi.getFlag("plan") === true) {
			planModeEnabled = true;
		}

		// getBranch() 而不是 getEntries()：会话是一棵树，getEntries() 返回整个文件（含被
		// 抛弃的分支）。用户 rewind 之后，文件顺序最后一条 plan-mode entry 可能属于另一条
		// 分支，.pop() 会把那条路的 executing/todos 装回来。这里要的是当前 root→leaf 路径。
		// 注意别换成 buildContextEntries()：它会裁掉 compaction 割点之前的 entry，状态会直接丢。
		const entries = ctx.sessionManager.getBranch();
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
			// 找不到执行起点就别猜：从 entries[0] 扫会把整个会话（含上一轮计划）的
			// [DONE:n] 都当成本轮进度，误标已完成会直接跳步。
			// todos 的 completed 已随 plan-mode entry 持久化，跳过这里只是少一层兜底。
			if (executeIndex >= 0) {
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
		}

		if (planModeEnabled) {
			enablePlanModeTools(pi);
		}
		updateStatus(ctx);
	});
}
