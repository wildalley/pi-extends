/**
 * Cometix 风格单行 footer（二开自 MIT 项目 pi-cometix-footer，Xichun123）。
 * 显示：模型+thinking | 目录 | Git 分支与状态 | 上下文 | token 用量 | 费用 | 任务时长+TPS。
 * 颜色跟随当前主题（theme.fg），而非硬编码 16 色。
 */

import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { icon } from "./icons.ts";
import { spark } from "./ui-kit.ts";
import { isAbsolute, relative, resolve, sep } from "node:path";

const DEFAULT_SHOW_TPS = true;
const GIT_TTL = 3000;

const RESET = "\x1b[0m";
const SEG = `\x1b[2m | ${RESET}`;

interface GitStatus {
	dirty: boolean;
	conflicts: boolean;
	ahead: number;
	behind: number;
}

function parseGitPorcelain(out: string): GitStatus {
	const s: GitStatus = { dirty: false, conflicts: false, ahead: 0, behind: 0 };
	for (const line of out.split("\n")) {
		if (line.startsWith("## ")) {
			const m = line.match(/\[(?:ahead (\d+)(?:,? behind (\d+))?|behind (\d+)(?:,? ahead (\d+))?)\]/);
			if (m) {
				s.ahead = Number(m[1] ?? m[4] ?? 0);
				s.behind = Number(m[2] ?? m[3] ?? 0);
			}
		} else if (line.length >= 2) {
			const xy = line.slice(0, 2);
			if (xy === "!!" || xy === "??") {
				s.dirty = true;
			} else if (/^(UU|AA|DD|AU|UA|DU|UD)$/.test(xy)) {
				s.conflicts = true;
				s.dirty = true;
			} else {
				s.dirty = true;
			}
		}
	}
	return s;
}

function fmtCwd(cwd: string, home: string | undefined): string {
	if (!home) return cwd;
	const r = relative(resolve(home), resolve(cwd));
	if (r === "") return "~";
	if (r === ".." || r.startsWith(`..${sep}`) || isAbsolute(r)) return cwd;
	return `~${sep}${r}`;
}

function fmtTok(n: number): string {
	if (n < 1000) return String(n);
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	return `${Math.round(n / 1_000_000)}M`;
}

function formatDuration(durationMs: number): string {
	if (!Number.isFinite(durationMs) || durationMs < 0) return "?";
	const totalSeconds = Math.round(durationMs / 1000);
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (totalMinutes < 60) return `${totalMinutes}m ${seconds}s`;
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}h ${minutes}m`;
}

/**
 * 累计重发这么多输入 token、且一次缓存都没命中，就把 CH0% 标红。
 *
 * 为什么需要这个：原来 CH 段只在 cacheRead/cacheWrite 有值时才出现，于是
 * 「链路根本不支持提示缓存」这件事表现为 footer 上什么都不显示 —— 最贵的故障
 * 长得跟一切正常一模一样。而没有缓存时每一轮都在全价重发整个上下文，
 * 长会话的花费是轮数的平方级，等到发现时账已经出来了。
 */
export const NO_CACHE_WARN_INPUT = 200_000;

/** 至少这么多轮才判定，避免「一次贴了个大文件」被当成链路故障。 */
export const NO_CACHE_WARN_TURNS = 3;

export interface CacheHitView {
	text: string;
	/** true 表示这是告警（一次都没命中），渲染成 error 色。 */
	warn: boolean;
}

/** footer 里缓存命中那一段。返回 undefined 表示这一段不该出现。 */
export function formatCacheHit(t: {
	input: number;
	turns: number;
	cacheRead: number;
	cacheWrite: number;
	lastCacheHit?: number;
}): CacheHitView | undefined {
	if (t.cacheRead > 0 || t.cacheWrite > 0) {
		return t.lastCacheHit == null ? undefined : { text: `CH${t.lastCacheHit.toFixed(1)}%`, warn: false };
	}
	if (t.turns >= NO_CACHE_WARN_TURNS && t.input >= NO_CACHE_WARN_INPUT) {
		return { text: "CH0%", warn: true };
	}
	return undefined;
}

/**
 * Token / 费用累计。
 *
 * 原来每次 render 都遍历整个 session 的全部 entry 重算一遍。而 render 在任务期间
 * 每秒至少一次，长会话下是每秒一次 O(entries) 扫描。这些量是单调累加的，
 * 在 message_end 里增量累计即可；只在 session_start / 恢复会话时全量扫一次。
 */
class UsageTotals {
	input = 0;
	output = 0;
	cacheRead = 0;
	cacheWrite = 0;
	cost = 0;
	/** 已计入的助手回合数，用于判断「没有缓存」是不是真的成了常态。 */
	turns = 0;
	lastCacheHit: number | undefined;

	reset(): void {
		this.input = 0;
		this.output = 0;
		this.cacheRead = 0;
		this.cacheWrite = 0;
		this.cost = 0;
		this.turns = 0;
		this.lastCacheHit = undefined;
	}

	add(usage: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		cost?: { total?: number };
	}): void {
		const cr = usage.cacheRead ?? 0;
		const cw = usage.cacheWrite ?? 0;
		this.input += usage.input ?? 0;
		this.output += usage.output ?? 0;
		this.cacheRead += cr;
		this.cacheWrite += cw;
		this.cost += usage.cost?.total ?? 0;
		this.turns++;
		const prompt = (usage.input ?? 0) + cr + cw;
		if (prompt > 0) {
			this.lastCacheHit = (cr / prompt) * 100;
		}
	}

	/** 恢复既有会话时用：全量扫一次，之后交给增量累计。 */
	seedFrom(entries: readonly unknown[]): void {
		this.reset();
		for (const e of entries) {
			const entry = e as { type?: string; message?: { role?: string; usage?: unknown } };
			if (entry?.type === "message" && entry.message?.role === "assistant" && entry.message.usage) {
				this.add(entry.message.usage as Parameters<UsageTotals["add"]>[0]);
			}
		}
	}
}

/**
 * 火花线保留多少轮。
 *
 * 8 是「够看出趋势」和「footer 只有一行」的折中：footer 要跟模型名、目录、Git、
 * 上下文、用量、费用挤在同一行，窄终端上先被截掉的就是最右边的时长段。
 * 8 列约等于两个汉字宽，看得出升降，又不至于把别的段挤掉。
 */
const TPS_HISTORY = 8;

class TpsTracker {
	private firstOutputAt: number | undefined;

	/** 最近若干轮的 TPS，新的在后。只在 finish() 拿到有效值时才追加。 */
	readonly history: number[] = [];

	start(): void {
		this.firstOutputAt = undefined;
	}

	noteOutput(delta: string, now = Date.now()): void {
		if (delta.length > 0 && this.firstOutputAt === undefined) {
			this.firstOutputAt = now;
		}
	}

	finish(outputTokens: number, now = Date.now()): number | undefined {
		const firstOutputAt = this.firstOutputAt;
		this.firstOutputAt = undefined;
		const elapsedMs = firstOutputAt === undefined ? 0 : now - firstOutputAt;
		if (!Number.isFinite(outputTokens) || outputTokens <= 0 || elapsedMs <= 0) return undefined;
		const tps = outputTokens / (elapsedMs / 1000);
		this.history.push(tps);
		if (this.history.length > TPS_HISTORY) {
			this.history.shift();
		}
		return tps;
	}
}

/** 供 cockpit 控制台读写 footer 开关的句柄（在 registerFooter 中装配）。 */
export interface FooterController {
	isEnabled(): boolean;
	isTpsEnabled(): boolean;
	setEnabled(ctx: ExtensionContext, enabled: boolean): void;
	setTps(enabled: boolean): void;
}

export const footerController: Partial<FooterController> = {};

export default function registerFooter(pi: ExtensionAPI): void {
	let userEnabled = true;
	let tpsEnabled = DEFAULT_SHOW_TPS;
	let elapsedTimer: ReturnType<typeof setInterval> | undefined;
	let unsubBranch: (() => void) | undefined;
	let requestFooterRender: (() => void) | undefined;

	const tpsTracker = new TpsTracker();
	const totals = new UsageTotals();
	/** 「本通道没有缓存」只提醒一次，按会话重置。 */
	let noCacheWarned = false;
	let latestTps: number | undefined;
	let taskStartedAt: number | undefined;
	let latestTaskDurationMs: number | undefined;

	let gitCache: { ts: number; data: GitStatus } = {
		ts: 0,
		data: { dirty: false, conflicts: false, ahead: 0, behind: 0 },
	};
	let gitInFlight = false;

	function stopElapsedTicker(): void {
		if (elapsedTimer) clearInterval(elapsedTimer);
		elapsedTimer = undefined;
	}

	function startElapsedTicker(): void {
		stopElapsedTicker();
		if (taskStartedAt === undefined || !requestFooterRender) return;
		elapsedTimer = setInterval(() => requestFooterRender?.(), 1000);
	}

	async function refreshGit(cwd: string, branch: string | null): Promise<void> {
		if (gitInFlight) return;
		if (!branch) {
			gitCache = { ts: Date.now(), data: { dirty: false, conflicts: false, ahead: 0, behind: 0 } };
			return;
		}
		gitInFlight = true;
		try {
			const r = await pi.exec("git", ["status", "-b", "--porcelain=v1"], { cwd, timeout: 3000 });
			const data = r.code === 0 ? parseGitPorcelain(r.stdout) : gitCache.data;
			gitCache = { ts: Date.now(), data };
		} catch {
			// keep previous cache
		} finally {
			gitInFlight = false;
		}
	}

	function installFooter(ctx: ExtensionContext): void {
		unsubBranch?.();
		unsubBranch = undefined;

		ctx.ui.setFooter((tui: TUI, theme: Theme, footerData: ReadonlyFooterDataProvider) => {
			const requestRender = () => tui.requestRender();
			requestFooterRender = requestRender;
			startElapsedTicker();

			unsubBranch = footerData.onBranchChange(() => {
				void refreshGit(ctx.cwd, footerData.getGitBranch());
				tui.requestRender();
			});

			// 这里刻意不挂定时器。git 状态由 render 里的 TTL 检查按需拉取：
			// 空闲时没有 render，也就不该有 `git status` 子进程；任务进行中 elapsedTicker
			// 每秒触发 render，TTL 会把刷新频率自然限制在 GIT_TTL —— 和原来的定时器同频，
			// 但不会在无人看的时候每 3 秒 fork 一次。
			return {
				invalidate() {},
				dispose() {
					stopElapsedTicker();
					unsubBranch?.();
					unsubBranch = undefined;
					if (requestFooterRender === requestRender) requestFooterRender = undefined;
				},
				render(width: number): string[] {
					const now = Date.now();
					if (now - gitCache.ts > GIT_TTL) {
						void refreshGit(ctx.cwd, footerData.getGitBranch()).then(() => tui.requestRender());
					}

					const home = process.env.HOME || process.env.USERPROFILE;
					const fg = (token: ThemeColor, text: string) => theme.fg(token, text);
					const bold = (text: string) => theme.bold(text);

					const modelId = ctx.model?.name || ctx.model?.id || "no-model";
					const lvl = pi.getThinkingLevel();
					const showLvl = !!ctx.model?.reasoning && !!lvl && lvl !== "off";
					let modelSeg: string;
					if (showLvl) {
						const lvlToken = `thinking${lvl.charAt(0).toUpperCase()}${lvl.slice(1)}` as ThemeColor;
						modelSeg = bold(fg("accent", `${icon("model")} ${modelId}`)) + ` ${fg("dim", "•")} ${fg(lvlToken, lvl)}`;
					} else {
						modelSeg = bold(fg("accent", `${icon("model")} ${modelId}`));
					}

					const dirText = fmtCwd(ctx.sessionManager.getCwd(), home);
					const dirSeg = bold(fg("warning", `${icon("dir")} `)) + fg("success", dirText);

					const branch = footerData.getGitBranch();
					let gitSeg = "";
					if (branch) {
						const g = gitCache.data;
						let st = ` ${icon("check")}`;
						if (g.conflicts) st = ` ${icon("warn")}`;
						else if (g.dirty) st = ` ${icon("dirty")}`;
						let remote = "";
						if (g.ahead > 0) remote += ` ↑${g.ahead}`;
						if (g.behind > 0) remote += ` ↓${g.behind}`;
						gitSeg = bold(fg("mdLink", `${icon("git")} ${branch}${st}${remote}`));
					}

					const cu = ctx.getContextUsage();
					const pct = cu?.percent;
					const pctStr = pct != null ? `${Math.round(pct)}%` : "?";
					const tokStr = cu?.tokens != null ? fmtTok(cu.tokens) : "?";
					const winStr = cu?.contextWindow ? fmtTok(cu.contextWindow) : "?";
					const ctxColor: ThemeColor =
						pct == null ? "thinkingHigh" : pct > 90 ? "error" : pct > 70 ? "warning" : "thinkingHigh";
					const ctxSeg = bold(fg(ctxColor, `${icon("ctx")} ${pctStr} ${tokStr}/${winStr}`));

					const tokText = `${icon("usage")} ↑${fmtTok(totals.input)} ↓${fmtTok(totals.output)}`;
					const cacheView = formatCacheHit(totals);
					let tokSeg = bold(fg("accent", tokText));
					if (cacheView) {
						tokSeg += bold(fg(cacheView.warn ? "error" : "accent", ` ${cacheView.text}`));
					}
					const costSeg =
						totals.cost > 0 ? fg("warning", `${icon("cost")} ${totals.cost.toFixed(3)}`) : "";

					const displayedTaskDurationMs =
						taskStartedAt != null ? Math.max(0, now - taskStartedAt) : latestTaskDurationMs;
					let durationText =
						displayedTaskDurationMs != null
							? `${icon("duration")} ${formatDuration(displayedTaskDurationMs)}`
							: "";
					if (tpsEnabled && latestTps != null) {
						durationText += `${durationText ? " · " : ""}${latestTps.toFixed(1)} tok/s`;
					}
					let durationSeg = durationText ? fg("thinkingHigh", durationText) : "";
					// 火花线跟在数字后面：数字是「这一轮多快」，火花线是「比前几轮快还是慢」。
					// 单看一个数字看不出这个，而生成速度突然掉一半通常意味着换了模型或换了
					// thinking 档位 —— 这类变化值得当场看见，不该等到翻账单才发现。
					// 少于两轮不画：一根柱子表达不了趋势。
					if (tpsEnabled && tpsTracker.history.length >= 2) {
						durationSeg += ` ${spark(theme, tpsTracker.history, "dim")}`;
					}

					const segs = [modelSeg, dirSeg];
					if (gitSeg) segs.push(gitSeg);
					segs.push(ctxSeg, tokSeg);
					if (durationSeg) segs.push(durationSeg);
					if (costSeg) segs.push(costSeg);

					const statuses = footerData.getExtensionStatuses();
					if (statuses.size > 0) {
						const statusLine = Array.from(statuses.entries())
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([, t]) => (t ?? "").replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim())
							.join(" ");
						if (statusLine) {
							segs.push(statusLine);
						}
					}

					let line = segs.join(SEG);
					if (visibleWidth(line) > width) {
						line = truncateToWidth(line, width, "");
					}
					return [line];
				},
			};
		});
	}

	function teardownFooter(ctx: ExtensionContext): void {
		ctx.ui.setFooter(undefined);
		stopElapsedTicker();
		unsubBranch?.();
		unsubBranch = undefined;
	}

	function setFooterEnabled(ctx: ExtensionContext, enabled: boolean): void {
		if (ctx.mode !== "tui") return;
		userEnabled = enabled;
		if (enabled) {
			installFooter(ctx);
		} else {
			teardownFooter(ctx);
		}
	}

	footerController.isEnabled = () => userEnabled;
	footerController.isTpsEnabled = () => tpsEnabled;
	footerController.setEnabled = setFooterEnabled;
	footerController.setTps = (enabled: boolean) => {
		tpsEnabled = enabled;
		requestFooterRender?.();
	};

	pi.on("message_start", (event) => {
		if (event.message.role === "user") {
			taskStartedAt = event.message.timestamp;
			latestTaskDurationMs = undefined;
			latestTps = undefined;
			startElapsedTicker();
			requestFooterRender?.();
		} else if (event.message.role === "assistant") {
			tpsTracker.start();
		}
	});

	pi.on("message_update", (event) => {
		if (event.message.role !== "assistant") return;
		const update = event.assistantMessageEvent;
		if (
			(update.type === "text_delta" || update.type === "thinking_delta" || update.type === "toolcall_delta") &&
			update.delta.length > 0
		) {
			tpsTracker.noteOutput(update.delta);
		}
	});

	pi.on("message_end", (event, ctx) => {
		if (event.message.role !== "assistant") return;
		totals.add(event.message.usage);
		// 只提醒一次：这是链路属性，不是这一轮的问题，每轮弹一次只会被无视。
		if (!noCacheWarned && formatCacheHit(totals)?.warn === true) {
			noCacheWarned = true;
			try {
				ctx.ui.notify(
					"当前通道没有任何提示缓存命中：每一轮都在全价重发整个上下文，花费随轮数平方增长。考虑及早压缩上下文、把探索交给子代理，或换一条支持缓存的通道。",
					"warning",
				);
			} catch {
				// 提示失败不该影响 footer
			}
		}
		latestTps = tpsTracker.finish(event.message.usage.output);
		requestFooterRender?.();
	});

	pi.on("agent_settled", () => {
		if (taskStartedAt === undefined) return;
		latestTaskDurationMs = Math.max(0, Date.now() - taskStartedAt);
		taskStartedAt = undefined;
		stopElapsedTicker();
		requestFooterRender?.();
	});

	pi.on("session_start", (_event, ctx) => {
		latestTps = undefined;
		tpsTracker.start();
		taskStartedAt = undefined;
		latestTaskDurationMs = undefined;
		stopElapsedTicker();
		// 新会话时 entries 为空，等价于清零；恢复会话时把既有用量扫进来，之后交给 message_end 增量累计。
		totals.seedFrom(ctx.sessionManager?.getEntries() ?? []);
		noCacheWarned = false;
		if (ctx.mode !== "tui" || !userEnabled) return;
		installFooter(ctx);
	});

	pi.registerCommand("footer", {
		description: "切换 cometix 风格 footer，或 /footer tps 切换 TPS 显示",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") return;
			const [action, value] = args.trim().toLowerCase().split(/\s+/);
			if (action === "tps") {
				if (value === "on") tpsEnabled = true;
				else if (value === "off") tpsEnabled = false;
				else tpsEnabled = !tpsEnabled;
				requestFooterRender?.();
				ctx.ui.notify(`Footer TPS ${tpsEnabled ? "on" : "off"}`, "info");
				return;
			}
			if (action) {
				ctx.ui.notify("用法: /footer [tps [on|off]]", "warning");
				return;
			}
			setFooterEnabled(ctx, !userEnabled);
			ctx.ui.notify(userEnabled ? "Cometix footer on" : "Cometix footer off（恢复默认）", "info");
		},
	});
}
