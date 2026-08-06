/**
 * Cometix 风格单行 footer（二开自 MIT 项目 pi-cometix-footer，Xichun123）。
 * 显示：模型+thinking | 目录 | Git 分支与状态 | 上下文 | token 用量 | 费用 | 任务时长+TPS。
 * 颜色跟随当前主题（theme.fg），而非硬编码 16 色。
 */

import type { ExtensionAPI, ExtensionContext, ReadonlyFooterDataProvider, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isAbsolute, relative, resolve, sep } from "node:path";

const ICON_MODE: "nerd" | "emoji" = "emoji";
const DEFAULT_SHOW_TPS = true;
const GIT_TTL = 3000;

const cp = (n: number) => String.fromCodePoint(n);
const ICONS = {
	nerd: {
		model: "\ue22c",
		dir: "\ue285",
		git: cp(0xf02a2),
		ctx: "\uf49b",
		usage: cp(0xf0a9e),
		cost: cp(0xf01c1),
		duration: cp(0xf0109),
	},
	emoji: {
		model: "🧠",
		dir: "📁",
		git: "🌿",
		ctx: "⚡",
		usage: "📊",
		cost: "💰",
		duration: "⏱️",
	},
}[ICON_MODE];

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

class TpsTracker {
	private firstOutputAt: number | undefined;

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
		return outputTokens / (elapsedMs / 1000);
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
	let timer: ReturnType<typeof setInterval> | undefined;
	let elapsedTimer: ReturnType<typeof setInterval> | undefined;
	let unsubBranch: (() => void) | undefined;
	let requestFooterRender: (() => void) | undefined;

	const tpsTracker = new TpsTracker();
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
		if (timer) clearInterval(timer);
		timer = undefined;
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
			timer = setInterval(() => {
				void refreshGit(ctx.cwd, footerData.getGitBranch()).then(() => tui.requestRender());
			}, GIT_TTL);

			return {
				invalidate() {},
				dispose() {
					if (timer) clearInterval(timer);
					timer = undefined;
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
						modelSeg = bold(fg("accent", `${ICONS.model}  ${modelId}`)) + ` ${fg("dim", "•")} ${fg(lvlToken, lvl)}`;
					} else {
						modelSeg = bold(fg("accent", `${ICONS.model}  ${modelId}`));
					}

					const dirText = fmtCwd(ctx.sessionManager.getCwd(), home);
					const dirSeg = bold(fg("warning", `${ICONS.dir} `)) + fg("success", dirText);

					const branch = footerData.getGitBranch();
					let gitSeg = "";
					if (branch) {
						const g = gitCache.data;
						let st = " ✓";
						if (g.conflicts) st = " ⚠";
						else if (g.dirty) st = " ●";
						let remote = "";
						if (g.ahead > 0) remote += ` ↑${g.ahead}`;
						if (g.behind > 0) remote += ` ↓${g.behind}`;
						gitSeg = bold(fg("mdLink", `${ICONS.git} ${branch}${st}${remote}`));
					}

					const cu = ctx.getContextUsage();
					const pct = cu?.percent;
					const pctStr = pct != null ? `${Math.round(pct)}%` : "?";
					const tokStr = cu?.tokens != null ? fmtTok(cu.tokens) : "?";
					const winStr = cu?.contextWindow ? fmtTok(cu.contextWindow) : "?";
					const ctxColor: ThemeColor =
						pct == null ? "thinkingHigh" : pct > 90 ? "error" : pct > 70 ? "warning" : "thinkingHigh";
					const ctxSeg = bold(fg(ctxColor, `${ICONS.ctx} ${pctStr} ${tokStr}/${winStr}`));

					let tin = 0;
					let tout = 0;
					let totalCR = 0;
					let totalCW = 0;
					let totalCost = 0;
					let lastHit: number | undefined;
					for (const e of ctx.sessionManager.getEntries()) {
						if (e?.type === "message" && (e as { message?: { role?: string } }).message?.role === "assistant") {
							const u = (e as { message?: { usage?: any } }).message?.usage;
							if (u) {
								tin += u.input ?? 0;
								tout += u.output ?? 0;
								const cr = u.cacheRead ?? 0;
								const cw = u.cacheWrite ?? 0;
								totalCR += cr;
								totalCW += cw;
								totalCost += u.cost?.total ?? 0;
								const prompt = (u.input ?? 0) + cr + cw;
								if (prompt > 0) lastHit = (cr / prompt) * 100;
							}
						}
					}
					let tokText = `${ICONS.usage} ↑${fmtTok(tin)} ↓${fmtTok(tout)}`;
					if ((totalCR > 0 || totalCW > 0) && lastHit != null) {
						tokText += ` CH${lastHit.toFixed(1)}%`;
					}
					const tokSeg = bold(fg("accent", tokText));
					const costSeg = totalCost > 0 ? fg("warning", `${ICONS.cost} ${totalCost.toFixed(3)}`) : "";

					const displayedTaskDurationMs =
						taskStartedAt != null ? Math.max(0, now - taskStartedAt) : latestTaskDurationMs;
					let durationText =
						displayedTaskDurationMs != null
							? `${ICONS.duration} ${formatDuration(displayedTaskDurationMs)}`
							: "";
					if (tpsEnabled && latestTps != null) {
						durationText += `${durationText ? " · " : ""}${latestTps.toFixed(1)} tok/s`;
					}
					const durationSeg = durationText ? fg("thinkingHigh", durationText) : "";

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
		if (timer) clearInterval(timer);
		timer = undefined;
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

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
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
