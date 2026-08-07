import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import type { PiExtendsConfig, RoleName } from "./config.ts";
import { icon } from "./icons.ts";
import { getPiInvocation, runPiChild } from "./pi-child.ts";
import { isPlanModeActive } from "./plan-mode.ts";
import { getAPI } from "./runtime.ts";
import { getConfig } from "./store.ts";
import {
	formatUsage,
	getFinalOutput,
	isMessageEndEvent,
	isToolResultEndEvent,
	parseJsonlLine,
	truncateOutput,
} from "./subagent-parse.ts";

const COLLAPSED_ITEM_COUNT = 10;
/** 单个子代理的墙钟上限。挂住的子进程不该让工具调用无限期悬停。 */
const SUBAGENT_TIMEOUT_MS = 600_000;

export const ROLE_SYSTEM_PROMPTS: Record<RoleName, string> = {
	scout: `你是 Scout：只读的快速侦察代理。
你的任务是定位文件、函数、调用关系和相关实现，并返回压缩后的发现。
只使用只读工具（read/grep/find/ls）。不要修改任何文件。
输出要求：以简洁的 markdown 列表给出文件路径和行号。`,
	planner: `你是 Planner：只读的规划代理。
综合已有上下文，输出可执行的编号计划。不要修改任何文件。
输出要求：在最终回答中按顺序输出步骤，并在 "Plan:" 标题下列出编号步骤。`,
	worker: `你是 Worker：实现代理。
负责实现和验证任务。可以使用完整的编码工具（read/bash/edit/write）。
执行步骤前后验证结果，并在最终回答中总结改动。`,
	reviewer: `你是 Reviewer：只读的代码审查代理。
以代码审查方式检查缺陷、回归和测试缺口。不要修改任何文件。
输出要求：列出问题清单（严重程度 + 文件位置 + 建议），并给出测试缺口。`,
};

interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

interface SingleResult {
	role: string;
	task: string;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	stopReason?: string;
	errorMessage?: string;
	step?: number;
}

interface SubagentDetails {
	mode: "single" | "parallel" | "chain";
	results: SingleResult[];
}

const SubagentParams = Type.Object({
	role: Type.Optional(
		Type.String({ description: "角色：scout | planner | worker | reviewer（single 模式）" }),
	),
	task: Type.Optional(Type.String({ description: "任务描述（single 模式）" })),
	tasks: Type.Optional(
		Type.Array(
			Type.Object({
				role: Type.String({ description: "角色名" }),
				task: Type.String({ description: "任务描述" }),
			}),
			{ description: "并行任务数组（parallel 模式）" },
		),
	),
	chain: Type.Optional(
		Type.Array(
			Type.Object({
				role: Type.String({ description: "角色名" }),
				task: Type.String({
					description: "任务描述，可用 {previous} 引用上一步输出",
				}),
			}),
			{ description: "串行步骤数组（chain 模式）" },
		),
	),
});

type SubagentParams = Static<typeof SubagentParams>;

function isFailedResult(result: SingleResult): boolean {
	return (
		result.exitCode !== 0 ||
		result.stopReason === "error" ||
		result.stopReason === "aborted"
	);
}

function getResultOutput(result: SingleResult): string {
	if (isFailedResult(result)) {
		return (
			result.errorMessage ||
			result.stderr ||
			getFinalOutput(result.messages) ||
			"(no output)"
		);
	}
	return getFinalOutput(result.messages) || "(no output)";
}

function emptyUsage(): UsageStats {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 };
}

function formatUsageLocal(usage: UsageStats, model?: string): string {
	return formatUsage(usage, model);
}

async function writePromptToTempFile(role: string, prompt: string): Promise<{ dir: string; filePath: string }> {
	const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-extends-subagent-"));
	const safeName = role.replace(/[^\w.-]+/g, "_");
	const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
	await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	return { dir: tmpDir, filePath };
}

function roleSystemPrompt(
	config: PiExtendsConfig,
	role: RoleName,
): string {
	const configured = config.roles[role]?.systemPrompt;
	if (configured && configured.trim()) {
		return configured;
	}
	return ROLE_SYSTEM_PROMPTS[role];
}

function buildChildArgs(
	config: PiExtendsConfig,
	role: RoleName,
	task: string,
	promptFilePath: string | null,
): string[] {
	const args: string[] = ["--mode", "json", "-p", "--no-session"];
	const model = config.roles[role]?.model ?? config.currentModel.model;
	const thinking = config.roles[role]?.thinking ?? config.currentModel.thinking;
	if (model) args.push("--model", model);
	if (thinking) args.push("--thinking", thinking);
	const tools = config.roles[role]?.tools;
	if (tools && tools.length > 0) args.push("--tools", tools.join(","));
	if (promptFilePath) args.push("--append-system-prompt", promptFilePath);
	args.push(`Task: ${task}`);
	return args;
}

type OnUpdateCallback = (partial: {
	content: { type: "text"; text: string }[];
	details: SubagentDetails;
}) => void;

async function runSingleRole(
	ctx: ExtensionContext,
	config: PiExtendsConfig,
	role: string,
	task: string,
	step: number | undefined,
	signal: AbortSignal | undefined,
	onUpdate: OnUpdateCallback | undefined,
	makeDetails: (results: SingleResult[]) => SubagentDetails,
): Promise<SingleResult> {
	if (!(role in ROLE_SYSTEM_PROMPTS)) {
		return {
			role,
			task,
			exitCode: 1,
			messages: [],
			stderr: `未知角色 "${role}"。可用角色：${Object.keys(ROLE_SYSTEM_PROMPTS).join(", ")}。`,
			usage: emptyUsage(),
			step,
		};
	}
	const roleName = role as RoleName;
	const prompt = `${roleSystemPrompt(config, roleName)}\n\n${task}`;

	const currentResult: SingleResult = {
		role,
		task,
		exitCode: 0,
		messages: [],
		stderr: "",
		usage: emptyUsage(),
		model: config.roles[roleName]?.model ?? config.currentModel.model,
		step,
	};

	const emitUpdate = () => {
		if (onUpdate) {
			onUpdate({
				content: [{ type: "text", text: getFinalOutput(currentResult.messages) || "(running...)" }],
				details: makeDetails([currentResult]),
			});
		}
	};

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;
	try {
		const tmp = await writePromptToTempFile(roleName, prompt);
		tmpPromptDir = tmp.dir;
		tmpPromptPath = tmp.filePath;
		const args = buildChildArgs(config, roleName, task, tmpPromptPath);

		const processLine = (line: string) => {
			const event = parseJsonlLine(line);
			if (!event) return;
			if (isMessageEndEvent(event)) {
				const msg = event.message;
				currentResult.messages.push(msg);
				if (msg.role === "assistant") {
					currentResult.usage.turns++;
					const usage = msg.usage;
					if (usage) {
						currentResult.usage.input += usage.input || 0;
						currentResult.usage.output += usage.output || 0;
						currentResult.usage.cacheRead += usage.cacheRead || 0;
						currentResult.usage.cacheWrite += usage.cacheWrite || 0;
						currentResult.usage.cost += usage.cost?.total || 0;
						currentResult.usage.contextTokens = usage.totalTokens || 0;
					}
					if (!currentResult.model && msg.model) currentResult.model = msg.model;
					if (msg.stopReason) currentResult.stopReason = msg.stopReason;
					if (msg.errorMessage) currentResult.errorMessage = msg.errorMessage;
				}
				emitUpdate();
			}
			if (isToolResultEndEvent(event)) {
				currentResult.messages.push(event.message);
				emitUpdate();
			}
		};

		const child = await runPiChild({
			args,
			cwd: ctx.cwd,
			signal,
			timeoutMs: SUBAGENT_TIMEOUT_MS,
			onLine: processLine,
		});

		currentResult.exitCode = child.code;
		if (child.stderr) {
			currentResult.stderr += child.stderr;
		}
		if (child.timedOut) {
			currentResult.stopReason = "error";
			currentResult.errorMessage = `子代理超时（${Math.round(SUBAGENT_TIMEOUT_MS / 1000)}s）后被终止。`;
		}
		if (child.aborted) throw new Error("Subagent was aborted");
		return currentResult;
	} finally {
		if (tmpPromptDir) {
			await fs.promises.rm(tmpPromptDir, { recursive: true, force: true }).catch(() => {});
		}
	}
}

async function mapWithConcurrencyLimit<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;
	const workers = new Array(limit).fill(null).map(async () => {
		while (true) {
			const current = nextIndex++;
			if (current >= items.length) return;
			results[current] = await fn(items[current], current);
		}
	});
	await Promise.all(workers);
	return results;
}

type DisplayItem = { type: "text"; text: string } | { type: "toolCall"; name: string; args: Record<string, unknown> };

function getDisplayItems(messages: Message[]): DisplayItem[] {
	const items: DisplayItem[] = [];
	for (const msg of messages) {
		if (msg.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") items.push({ type: "text", text: part.text });
				else if (part.type === "toolCall")
					items.push({ type: "toolCall", name: part.name, args: part.arguments as Record<string, unknown> });
			}
		}
	}
	return items;
}

function renderItems(items: DisplayItem[], limit: number | undefined): string {
	const toShow = limit ? items.slice(-limit) : items;
	const skipped = limit && items.length > limit ? items.length - limit : 0;
	let text = "";
	if (skipped > 0) text += `... ${skipped} earlier items\n`;
	for (const item of toShow) {
		if (item.type === "text") {
			const preview = item.text.split("\n").slice(0, 3).join("\n");
			text += `${preview}\n`;
		} else {
			text += `→ ${item.name} ${JSON.stringify(item.args).slice(0, 80)}\n`;
		}
	}
	return text.trimEnd();
}

export function registerSubagentTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "subagent",
		label: "Subagent",
		description: [
			"将任务委托给隔离上下文的角色化子代理。",
			"模式：single（role+task）、parallel（tasks 数组）、chain（串行，可用 {previous} 引用上一步结果）。",
			"角色：scout（只读侦察）、planner（只读规划）、worker（完整工具）、reviewer（只读审查）。",
		].join(" "),
		parameters: SubagentParams,

		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
			const hasChain = (params.chain?.length ?? 0) > 0;
			const hasTasks = (params.tasks?.length ?? 0) > 0;
			const hasSingle = Boolean(params.role && params.task);
			const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

			const makeDetails =
				(mode: "single" | "parallel" | "chain") =>
				(results: SingleResult[]): SubagentDetails => ({
					mode,
					results,
				});

			if (modeCount !== 1) {
				return {
					content: [
						{
							type: "text",
							text: `无效参数。需要且仅需要一种模式。可用角色：${Object.keys(ROLE_SYSTEM_PROMPTS).join(", ")}。`,
						},
					],
					details: makeDetails("single")([]),
				};
			}

			const requestedRoles = new Set<string>();
			if (params.chain) for (const step of params.chain) requestedRoles.add(step.role);
			if (params.tasks) for (const t of params.tasks) requestedRoles.add(t.role);
			if (params.role) requestedRoles.add(params.role);
			if (isPlanModeActive() && requestedRoles.has("worker")) {
				return {
					content: [
						{
							type: "text",
							text: "Plan 模式下禁止启动具有写权限的 worker 子代理。请先 /plan off 或改用只读角色（scout/planner/reviewer）。",
						},
					],
					details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
					isError: true,
				};
			}

			if (params.chain && params.chain.length > 0) {
				const results: SingleResult[] = [];
				let previousOutput = "";
				for (let i = 0; i < params.chain.length; i++) {
					const step = params.chain[i];
					const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);
					const chainUpdate: OnUpdateCallback | undefined = onUpdate
						? (partial) => {
								const currentResult = partial.details?.results[0];
								if (currentResult) {
									onUpdate({
										content: partial.content,
										details: makeDetails("chain")([...results, currentResult]),
									});
								}
							}
						: undefined;
					const result = await runSingleRole(
						ctx,
						config,
						step.role,
						taskWithContext,
						i + 1,
						signal,
						chainUpdate,
						makeDetails("chain"),
					);
					results.push(result);
					if (isFailedResult(result)) {
						return {
							content: [
								{
									type: "text",
									text: `Chain 在第 ${i + 1} 步（${step.role}）停止：${getResultOutput(result)}`,
								},
							],
							details: makeDetails("chain")(results),
							isError: true,
						};
					}
					previousOutput = getFinalOutput(result.messages);
				}
				const last = results[results.length - 1];
				return {
					content: [{ type: "text", text: getFinalOutput(last?.messages ?? []) || "(no output)" }],
					details: makeDetails("chain")(results),
				};
			}

			if (params.tasks && params.tasks.length > 0) {
				const maxTasks = config.subagents.maxParallelTasks;
				if (params.tasks.length > maxTasks) {
					return {
						content: [
							{ type: "text", text: `并行任务过多（${params.tasks.length}）。上限为 ${maxTasks}。` },
						],
						details: makeDetails("parallel")([]),
					};
				}
				const allResults: SingleResult[] = new Array(params.tasks.length);
				for (let i = 0; i < params.tasks.length; i++) {
					allResults[i] = {
						role: params.tasks[i].role,
						task: params.tasks[i].task,
						exitCode: -1,
						messages: [],
						stderr: "",
						usage: emptyUsage(),
					};
				}
				const emitParallelUpdate = () => {
					if (onUpdate) {
						const running = allResults.filter((r) => r.exitCode === -1).length;
						const done = allResults.filter((r) => r.exitCode !== -1).length;
						onUpdate({
							content: [
								{ type: "text", text: `Parallel: ${done}/${allResults.length} done, ${running} running...` },
							],
							details: makeDetails("parallel")([...allResults]),
						});
					}
				};
				const results = await mapWithConcurrencyLimit(
					params.tasks,
					config.subagents.maxConcurrency,
					async (t, index) => {
						const result = await runSingleRole(
							ctx,
							config,
							t.role,
							t.task,
							undefined,
							signal,
							(partial) => {
								if (partial.details?.results[0]) {
									allResults[index] = partial.details.results[0];
									emitParallelUpdate();
								}
							},
							makeDetails("parallel"),
						);
						allResults[index] = result;
						emitParallelUpdate();
						return result;
					},
				);
				const successCount = results.filter((r) => !isFailedResult(r)).length;
				const summaries = results.map((r) => {
					const output = truncateOutput(getResultOutput(r));
					const status = isFailedResult(r)
						? `failed${r.stopReason && r.stopReason !== "end" ? ` (${r.stopReason})` : ""}`
						: "completed";
					return `### [${r.role}] ${status}\n\n${output}`;
				});
				return {
					content: [
						{
							type: "text",
							text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n---\n\n")}`,
						},
					],
					details: makeDetails("parallel")(results),
				};
			}

			if (params.role && params.task) {
				const result = await runSingleRole(
					ctx,
					config,
					params.role,
					params.task,
					undefined,
					signal,
					onUpdate as OnUpdateCallback | undefined,
					makeDetails("single"),
				);
				if (isFailedResult(result)) {
					return {
						content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${getResultOutput(result)}` }],
						details: makeDetails("single")([result]),
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
					details: makeDetails("single")([result]),
				};
			}

			return {
				content: [{ type: "text", text: `无效参数。可用角色：${Object.keys(ROLE_SYSTEM_PROMPTS).join(", ")}。` }],
				details: makeDetails("single")([]),
			};
		},

		renderCall(args: SubagentParams) {
			if (args.chain && args.chain.length > 0) {
				let text = `subagent chain (${args.chain.length} steps)`;
				for (const step of args.chain.slice(0, 3)) {
					const preview = step.task.replace(/\{previous\}/g, "").trim();
					text += `\n  ${step.role}: ${preview.length > 40 ? preview.slice(0, 40) + "..." : preview}`;
				}
				return new Text(text, 0, 0);
			}
			if (args.tasks && args.tasks.length > 0) {
				let text = `subagent parallel (${args.tasks.length} tasks)`;
				for (const t of args.tasks.slice(0, 3)) {
					text += `\n  ${t.role}: ${t.task.length > 40 ? t.task.slice(0, 40) + "..." : t.task}`;
				}
				return new Text(text, 0, 0);
			}
			const preview = args.task
				? args.task.length > 60
					? args.task.slice(0, 60) + "..."
					: args.task
				: "...";
			return new Text(`subagent ${args.role || "..."}\n  ${preview}`, 0, 0);
		},

		renderResult(result, options) {
			const details = result.details as SubagentDetails | undefined;
			if (!details || details.results.length === 0) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
			}
			const aggregate = details.results.reduce(
				(acc, r) => ({
					input: acc.input + r.usage.input,
					output: acc.output + r.usage.output,
					cacheRead: acc.cacheRead + r.usage.cacheRead,
					cacheWrite: acc.cacheWrite + r.usage.cacheWrite,
					cost: acc.cost + r.usage.cost,
					contextTokens: acc.contextTokens + r.usage.contextTokens,
					turns: acc.turns + r.usage.turns,
				}),
				{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, turns: 0 },
			);
			if (details.mode === "single" && details.results.length === 1) {
				const r = details.results[0];
				const isError = isFailedResult(r);
				const mark = isError ? icon("cross") : icon("check");
				const items = getDisplayItems(r.messages);
				let text = `${mark} ${r.role}`;
				if (isError && r.stopReason) text += ` [${r.stopReason}]`;
				if (isError && r.errorMessage) text += `\nError: ${r.errorMessage}`;
				else if (items.length === 0) text += `\n(no output)`;
				else {
					text += `\n${renderItems(items, options.expanded ? undefined : COLLAPSED_ITEM_COUNT)}`;
					if (items.length > COLLAPSED_ITEM_COUNT) text += `\n(Ctrl+O to expand)`;
				}
				const usageStr = formatUsageLocal(r.usage, r.model);
				if (usageStr) text += `\n${usageStr}`;
				return new Text(text, 0, 0);
			}
			const running = details.results.filter((r) => r.exitCode === -1).length;
			const successCount = details.results.filter(
				(r) => r.exitCode !== -1 && !isFailedResult(r),
			).length;
			const mark =
				running > 0 ? icon("pending") : successCount === details.results.length ? icon("check") : icon("warn");
			let text = `${mark} ${details.mode} ${successCount}/${details.results.length} tasks`;
			for (const r of details.results) {
				const rIcon = r.exitCode === -1 ? icon("pending") : isFailedResult(r) ? icon("cross") : icon("check");
				text += `\n${rIcon} ${r.role}`;
				const items = getDisplayItems(r.messages);
				if (items.length === 0) text += ` (${r.exitCode === -1 ? "running..." : "no output"})`;
				else text += `\n${renderItems(items, 5)}`;
			}
			const usageStr = formatUsageLocal(aggregate);
			if (usageStr) text += `\n\nTotal: ${usageStr}`;
			if (!options.expanded) text += `\n(Ctrl+O to expand)`;
			return new Text(text, 0, 0);
		},
	});
}

export async function runSubagentLauncher(
	ctx: ExtensionCommandContext,
	args: string,
): Promise<void> {
	const roles = ["scout", "planner", "worker", "reviewer"];
	const mode = await ctx.ui.select("子代理启动器（Esc 返回）", [
		"single：一个角色执行一个任务",
		"parallel：多个任务并行",
		"chain：串行，{previous} 引用上一步",
	]);
	if (mode === undefined) {
		return;
	}
	if (mode.startsWith("single")) {
		const role = await ctx.ui.select("选择角色", roles);
		if (role === undefined) {
			return;
		}
		const task = await ctx.ui.input("任务描述", "");
		if (task === undefined || task.trim() === "") {
			ctx.ui.notify("任务不能为空。", "warning");
			return;
		}
		await instructSubagent(ctx, { role, task });
		return;
	}
	if (mode.startsWith("parallel")) {
		const countRaw = await ctx.ui.input("并行任务数量", "2");
		const count = Math.max(1, Number.parseInt(countRaw ?? "2", 10) || 2);
		const tasks: { role: string; task: string }[] = [];
		for (let i = 0; i < count; i++) {
			const role = await ctx.ui.select(`任务 ${i + 1} 的角色`, roles);
			if (role === undefined) {
				return;
			}
			const task = await ctx.ui.input(`任务 ${i + 1} 描述`, "");
			if (task === undefined || task.trim() === "") {
				return;
			}
			tasks.push({ role, task });
		}
		await instructSubagent(ctx, { tasks });
		return;
	}
	if (mode.startsWith("chain")) {
		const countRaw = await ctx.ui.input("串行步骤数量", "2");
		const count = Math.max(2, Number.parseInt(countRaw ?? "2", 10) || 2);
		const chain: { role: string; task: string }[] = [];
		for (let i = 0; i < count; i++) {
			const role = await ctx.ui.select(`步骤 ${i + 1} 的角色`, roles);
			if (role === undefined) {
				return;
			}
			const prev = i > 0 ? "（可用 {previous} 引用上一步结果）" : "";
			const task = await ctx.ui.input(`步骤 ${i + 1} 描述 ${prev}`, "");
			if (task === undefined || task.trim() === "") {
				return;
			}
			chain.push({ role, task });
		}
		await instructSubagent(ctx, { chain });
		return;
	}
}

async function instructSubagent(
	ctx: ExtensionCommandContext,
	params: { role: string; task: string } | { tasks: { role: string; task: string }[] } | { chain: { role: string; task: string }[] },
): Promise<void> {
	const json = JSON.stringify(params);
	const message = `请使用 subagent 工具执行以下子代理任务（参数已就绪）：\n\`\`\`json\n${json}\n\`\`\``;
	getAPI().sendUserMessage(message, { deliverAs: "followUp" });
}
