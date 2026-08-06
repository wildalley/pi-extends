/**
 * 魔法关键词：输入里出现 ultrathink / orchestrate / workflowz 时改写这一轮的行为。
 *
 * 关键词只在「散文」里生效 —— 代码块、行内代码、XML/HTML 标签、标识符与路径中的
 * 同名单词一律不触发，否则聊代码时会被自己的文本反复劫持。
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "./config.ts";
import { getConfig } from "./store.ts";

export const MAGIC_KEYWORDS = ["ultrathink", "orchestrate", "workflowz"] as const;
export type MagicKeyword = (typeof MAGIC_KEYWORDS)[number];

export const KEYWORD_HINTS: Record<MagicKeyword, string> = {
	ultrathink: "把这一轮的 thinking 提到 max",
	orchestrate: "拆成并行子代理，再汇总",
	workflowz: "侦察 → 规划 → 实现 → 复审 全流水线",
};

/** 关键词命中后追加到用户输入末尾的指令。 */
const KEYWORD_DIRECTIVES: Record<MagicKeyword, string> = {
	ultrathink: `已触发 ultrathink：这一轮请把思考预算用满。先把问题拆开、列出候选方案与失败模式，再给结论；不要跳步。`,
	orchestrate: `已触发 orchestrate：请用 subagent 工具把上面的任务拆成可并行的子任务。
先用 parallel 模式派多个 scout 分头调查（每个子任务范围明确、互不重叠），
拿到结果后自己汇总成一份结论，必要时再派 worker 执行。不要一个人顺序做完。`,
	workflowz: `已触发 workflowz：请用 subagent 的 chain 模式跑完整流水线 ——
scout 定位相关代码 → planner 产出编号计划 → worker 按计划实现 → reviewer 复审。
每一步用 {previous} 接上一步的输出，最后汇报每一步的结论与最终改动。`,
};

/** 关键词前后不允许出现的字符：避免命中标识符、路径、kebab-case 的一部分。 */
const BOUNDARY = "A-Za-z0-9_\\-/.:";

/**
 * 抹掉不该触发关键词的区域（替换为等长空格，保持偏移不变便于调试）。
 * 顺序要紧：先围栏代码块，再行内代码，最后标签。
 */
export function maskNonProse(text: string): string {
	const blank = (m: string) => m.replace(/[^\n]/g, " ");
	return text
		.replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[ \t]*$/gm, blank)
		.replace(/^[ \t]*(```|~~~)[\s\S]*$/m, blank)
		.replace(/`[^`\n]*`/g, blank)
		.replace(/<\/?[A-Za-z][^>\n]*>/g, blank);
}

/** 找出输入里真正生效的关键词，按 MAGIC_KEYWORDS 的顺序返回。 */
export function findMagicKeywords(text: string): MagicKeyword[] {
	const prose = maskNonProse(text);
	return MAGIC_KEYWORDS.filter((kw) =>
		new RegExp(`(?<![${BOUNDARY}])${kw}(?![${BOUNDARY}])`).test(prose),
	);
}

/** 把命中的关键词指令拼到原文后面。原文保持不动，方便回看自己写了什么。 */
export function applyKeywords(text: string, hits: MagicKeyword[]): string {
	if (hits.length === 0) {
		return text;
	}
	const directives = hits.map((kw) => KEYWORD_DIRECTIVES[kw]).join("\n\n");
	return `${text}\n\n<pi-extends-keywords>\n${directives}\n</pi-extends-keywords>`;
}

let restoreThinking: ThinkingLevel | undefined;

export function registerKeywords(pi: ExtensionAPI): void {
	pi.on("input", (event, ctx) => {
		if (event.source !== "interactive") {
			return { action: "continue" };
		}
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		if (!config.keywords.enabled) {
			return { action: "continue" };
		}
		const hits = findMagicKeywords(event.text);
		if (hits.length === 0) {
			return { action: "continue" };
		}
		if (hits.includes("ultrathink")) {
			raiseThinking(pi, ctx);
		}
		ctx.ui.notify(`魔法关键词：${hits.join(" · ")}`, "info");
		return { action: "transform", text: applyKeywords(event.text, hits) };
	});

	// ultrathink 只作用于当轮：这一轮跑完就把 thinking 调回去。
	pi.on("agent_settled", (_event, ctx) => {
		if (restoreThinking !== undefined) {
			const level = restoreThinking;
			restoreThinking = undefined;
			pi.setThinkingLevel(level);
			ctx.ui.notify(`thinking 已恢复为 ${level}。`, "info");
		}
	});
}

function raiseThinking(pi: ExtensionAPI, ctx: ExtensionContext): void {
	const current = pi.getThinkingLevel();
	if (current === "max") {
		return;
	}
	if (restoreThinking === undefined) {
		restoreThinking = current;
	}
	pi.setThinkingLevel("max");
	ctx.ui.notify(`thinking 临时提到 max（原为 ${current}）。`, "info");
}
