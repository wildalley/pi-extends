/**
 * 自动分工：看出「这一条消息其实是好几件事」，然后把它交给并行子代理。
 *
 * 为什么需要它：`orchestrate` 这个魔法关键词早就能拆任务了，但前提是用户记得写。
 * 真正会一次丢五件事进来的人，通常正忙着描述这五件事，不会想起有个关键词。
 * 所以这里只补「提醒」这一步 —— 拆分的指令仍然是 keywords.ts 那一份，
 * 免得两处各写一份 prompt，改了一处忘了另一处。
 *
 * 打分刻意保守，也刻意可解释：每个信号都能对着原文指出来（「列了 5 条」「点了 4 个文件」），
 * 不然用户看到弹窗只会觉得被莫名打断。阈值 minComplexity 由用户定，默认 3 分，
 * 意味着单一信号（只是长、或者只说了一句「重构所有模块」）不会触发。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { applyKeywords, findMagicKeywords, maskNonProse } from "./keywords.ts";
import { getConfig } from "./store.ts";

export interface Complexity {
	score: number;
	/** 每条都对应原文里一个能指出来的事实，直接拿去给用户看。 */
	reasons: string[];
}

/** 低于这个长度一律不打分：一句话的请求再怎么组合信号也不值得拆。 */
const MIN_PROSE = 60;

/** 打分上限，避免长文档把分数堆到无意义的高位。 */
const MAX_SCORE = 8;

/**
 * 待办项标记：`1.` `2、` `3)` `- ` `第三步`。
 *
 * `\d` 后面要求不是数字，否则版本号（`gpt-4.1`、`3.5`）会被数成待办项。
 */
const LIST_MARK = /(?:^|[\s。；;，,])(?:\d{1,2}[.、)）](?!\d)|[-*•]\s|第[一二三四五六七八九十]+[步条个点])/g;

/** 有先后顺序的多步骤。整组只计一次，这些词单独出现太常见了。 */
const SEQUENCE = /然后|接着|之后|随后|再去|最后|并且|同时|以及|还要|还有|顺便|一并|then|after that|and then|next,|finally/i;

/** 覆盖面：一次动很多地方。每个不同的词计一分，最多两分。 */
const BREADTH = /所有|全部|每个|每一个|整个|逐个|批量|全项目|全仓库|重构|迁移|全面|梳理一遍|refactor|migrate|audit|rewrite|overhaul|every file/gi;

/** 明确点名的文件，三个以上说明工作面已经铺开了。 */
const FILE_REF = /[\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|c|h|cpp|hpp|cs|swift|json|ya?ml|toml|md|sql|sh)\b/gi;

/**
 * 给一条用户输入打「值得拆分吗」的分。
 *
 * 只看散文：代码块、行内代码、标签一律先抹掉（复用 keywords 的那套遮罩），
 * 否则贴一段代码进来就会因为里面的 `-` 和文件名被判成五件事。
 */
export function complexityScore(text: string): Complexity {
	const prose = maskNonProse(text).trim();
	if ([...prose].length < MIN_PROSE) {
		return { score: 0, reasons: [] };
	}
	const reasons: string[] = [];
	let score = 0;

	const items = prose.match(LIST_MARK)?.length ?? 0;
	if (items >= 5) {
		score += 3;
		reasons.push(`列了 ${items} 条待办`);
	} else if (items >= 3) {
		score += 2;
		reasons.push(`列了 ${items} 条待办`);
	} else if (items === 2) {
		score += 1;
		reasons.push("列了 2 条待办");
	}

	if (SEQUENCE.test(prose)) {
		score += 1;
		reasons.push("有先后顺序的多个步骤");
	}

	// 同一个词说三遍不该算三分，所以按「不同的词」去重。
	const breadth = [...new Set((prose.match(BREADTH) ?? []).map((w) => w.toLowerCase()))];
	if (breadth.length > 0) {
		score += Math.min(2, breadth.length);
		reasons.push(`覆盖面大（${breadth.slice(0, 3).join(" / ")}）`);
	}

	const files = [...new Set(prose.match(FILE_REF) ?? [])];
	if (files.length >= 3) {
		score += 1;
		reasons.push(`点名了 ${files.length} 个文件`);
	}

	const length = [...prose].length;
	if (length >= 800) {
		score += 2;
		reasons.push(`描述很长（${length} 字）`);
	} else if (length >= 400) {
		score += 1;
		reasons.push(`描述较长（${length} 字）`);
	}

	return { score: Math.min(MAX_SCORE, score), reasons };
}

/** 用户在本会话里明确说过「不用拆」，之后就别再问了。 */
let declined = false;

/** 仅供测试：把「问过一次」的状态清掉。 */
export function resetOrchestrationState(): void {
	declined = false;
}

export function registerOrchestration(pi: ExtensionAPI): void {
	pi.on("session_start", () => {
		declined = false;
	});

	pi.on("input", async (event, ctx) => {
		if (event.source !== "interactive") {
			return { action: "continue" };
		}
		// 流式过程中插话（steer）是在纠正正在做的事，这时候重新规划分工只会打乱它。
		if (event.streamingBehavior !== undefined) {
			return { action: "continue" };
		}
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const { mode, minComplexity } = config.orchestration;
		if (mode === "off") {
			return { action: "continue" };
		}
		// 用户自己写了魔法关键词：那条路正在做同一件事，别叠第二遍。
		// 这一条也顺带处理了 keywords 先于本处执行的情况 ——
		// 它注入的指令里就带着 orchestrate 这个词，会被这里认出来。
		if (findMagicKeywords(event.text).length > 0) {
			return { action: "continue" };
		}
		const complexity = complexityScore(event.text);
		if (complexity.score < minComplexity) {
			return { action: "continue" };
		}

		if (mode === "auto") {
			ctx.ui.notify(`自动分工：${complexity.reasons.join(" · ")} —— 已要求拆成并行子代理。`, "info");
			return { action: "transform", text: applyKeywords(event.text, ["orchestrate"]) };
		}

		// suggest：问一句再改。没有 UI 时什么都不做 —— 没人能回答的对话框会把这条输入卡死。
		if (!ctx.hasUI || declined) {
			return { action: "continue" };
		}
		const yes = await ctx.ui.confirm(
			"这一条看起来是好几件事，拆成并行子代理吗？",
			`${complexity.reasons.map((r) => `· ${r}`).join("\n")}\n\n选「是」会在这一轮末尾追加 orchestrate 指令：先派多个 scout 分头调查，汇总后再派 worker 执行。`,
		);
		if (!yes) {
			declined = true;
			ctx.ui.notify("这次不拆；本会话不再问。需要时自己写 orchestrate 即可。", "info");
			return { action: "continue" };
		}
		return { action: "transform", text: applyKeywords(event.text, ["orchestrate"]) };
	});
}
