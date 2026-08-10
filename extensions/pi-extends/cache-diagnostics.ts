import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import type { PiExtendsConfig } from "./config.ts";
import { trustZeroCacheMetrics } from "./config.ts";
import { getConfig } from "./store.ts";
import { kv, runInfoPage, sep } from "./ui-kit.ts";

export type CachePromptStatus = "sent" | "not-sent" | "unknown";
export type CacheMetricsStatus = "hit" | "write" | "zero" | "unknown";

export interface CacheDiagnosticRow {
	provider: string;
	model: string;
	input: number;
	cacheRead: number;
	cacheWrite: number;
	hitRate?: number;
	promptStatus: CachePromptStatus;
	metricsStatus: CacheMetricsStatus;
	conclusion: string;
}

interface AssistantUsageEntry {
	type?: string;
	message?: {
		role?: string;
		provider?: string;
		model?: string;
		usage?: {
			input?: number;
			cacheRead?: number;
			cacheWrite?: number;
		};
	};
}

function nonNegative(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function fullModelId(model: Pick<Model<any>, "provider" | "id">): string {
	return `${model.provider}/${model.id}`;
}

/** 根据最终注册到 Pi 的模型元数据判断本轮是否会带明确的缓存提示。 */
export function cachePromptStatus(
	model: Model<any> | undefined,
	config: PiExtendsConfig,
	providerId: string,
): CachePromptStatus {
	const custom = config.providers.find((provider) => provider.id === providerId);
	const api = model?.api ?? custom?.api;
	const compat = model?.compat as {
		cacheControlFormat?: "anthropic";
		supportsLongCacheRetention?: boolean;
	} | undefined;
	if (api === "anthropic-messages" || api === "openai-responses") {
		return "sent";
	}
	if (api !== "openai-completions") {
		return "unknown";
	}
	if (compat?.cacheControlFormat === "anthropic" || custom?.cache?.anthropicCacheControl) {
		return "sent";
	}
	if (model?.baseUrl.includes("api.openai.com")) {
		return "sent";
	}
	if (
		process.env.PI_CACHE_RETENTION === "long" &&
		(compat?.supportsLongCacheRetention ?? custom?.cache?.supportsLongRetention ?? true)
	) {
		return "sent";
	}
	return "not-sent";
}

function conclusion(prompt: CachePromptStatus, metrics: CacheMetricsStatus): string {
	if (metrics === "hit") return "缓存已命中，且中转返回了读取统计";
	if (metrics === "write") return "已写入缓存，本轮尚无可确认读取命中";
	if (prompt === "not-sent") {
		return metrics === "unknown"
			? "Pi 未发送明确缓存提示，且中转指标未知"
			: "Pi 未发送明确缓存提示，本轮为零命中";
	}
	if (prompt === "sent" && metrics === "zero") {
		return "Pi 已发送缓存提示；本轮未命中，中转也可能忽略了提示";
	}
	if (prompt === "sent" && metrics === "unknown") {
		return "Pi 已发送缓存提示；可能命中但未回传统计，无法确认";
	}
	return metrics === "zero"
		? "本轮为零命中；是否发送缓存提示无法确认"
		: "缓存提示与命中统计均无法确认";
}

/** 从当前 session 分支提取最近若干个 assistant 回合。 */
export function buildCacheDiagnostics(
	entries: readonly unknown[],
	config: PiExtendsConfig,
	models: readonly Model<any>[] = [],
	limit = 8,
): CacheDiagnosticRow[] {
	const byId = new Map(models.map((model) => [fullModelId(model), model]));
	const rows: CacheDiagnosticRow[] = [];
	for (let index = entries.length - 1; index >= 0 && rows.length < limit; index--) {
		const entry = entries[index] as AssistantUsageEntry;
		const message = entry.message;
		if (entry.type !== "message" || message?.role !== "assistant" || !message.usage) continue;
		const provider = message.provider ?? "unknown";
		const modelId = message.model ?? "unknown";
		const input = nonNegative(message.usage.input);
		const cacheRead = nonNegative(message.usage.cacheRead);
		const cacheWrite = nonNegative(message.usage.cacheWrite);
		const promptStatus = cachePromptStatus(byId.get(`${provider}/${modelId}`), config, provider);
		const metricsTrusted = trustZeroCacheMetrics(config, provider);
		const metricsStatus: CacheMetricsStatus =
			cacheRead > 0 ? "hit" : cacheWrite > 0 ? "write" : metricsTrusted ? "zero" : "unknown";
		const promptTokens = input + cacheRead + cacheWrite;
		rows.push({
			provider,
			model: modelId,
			input,
			cacheRead,
			cacheWrite,
			...(cacheRead > 0 && promptTokens > 0 ? { hitRate: (cacheRead / promptTokens) * 100 } : {}),
			promptStatus,
			metricsStatus,
			conclusion: conclusion(promptStatus, metricsStatus),
		});
	}
	return rows;
}

const PROMPT_LABELS: Record<CachePromptStatus, string> = {
	sent: "已发送",
	"not-sent": "未发送",
	unknown: "未知",
};

const METRICS_LABELS: Record<CacheMetricsStatus, string> = {
	hit: "读取命中",
	write: "仅写入",
	zero: "可信零值",
	unknown: "未可靠上报",
};

function tokenCount(value: number): string {
	return Math.round(value).toLocaleString("en-US");
}

export function formatCacheDiagnostics(rows: readonly CacheDiagnosticRow[]): string {
	if (rows.length === 0) return "当前分支还没有可诊断的模型回合。";
	return rows.map((row, index) => {
		const hit = row.hitRate === undefined ? "" : ` · 命中 ${row.hitRate.toFixed(1)}%`;
		return [
			`${index + 1}. ${row.provider}/${row.model}`,
			`input ${tokenCount(row.input)} · read ${tokenCount(row.cacheRead)} · write ${tokenCount(row.cacheWrite)}${hit}`,
			`提示 ${PROMPT_LABELS[row.promptStatus]} · 指标 ${METRICS_LABELS[row.metricsStatus]}`,
			row.conclusion,
		].join("\n");
	}).join("\n\n");
}

export async function cacheDiagnosticsPage(ctx: ExtensionContext): Promise<void> {
	const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
	const rows = buildCacheDiagnostics(
		ctx.sessionManager?.getBranch() ?? [],
		config,
		ctx.modelRegistry.getAll(),
	);
	if (ctx.mode !== "tui") {
		ctx.ui.notify(formatCacheDiagnostics(rows), "info");
		return;
	}
	if (rows.length === 0) {
		ctx.ui.notify("当前分支还没有可诊断的模型回合。", "info");
		return;
	}
	const theme = ctx.ui.theme;
	const lines: string[] = [];
	for (const [index, row] of rows.entries()) {
		if (index > 0) lines.push("");
		lines.push(theme.fg("accent", `${index + 1}. ${row.provider}/${row.model}`));
		lines.push(kv(
			theme,
			"▩",
			"Token",
			`input ${tokenCount(row.input)}${sep(theme)}read ${tokenCount(row.cacheRead)}${sep(theme)}write ${tokenCount(row.cacheWrite)}${row.hitRate === undefined ? "" : `${sep(theme)}命中 ${row.hitRate.toFixed(1)}%`}`,
		));
		lines.push(kv(
			theme,
			"◇",
			"证据",
			`${theme.fg(row.promptStatus === "sent" ? "success" : row.promptStatus === "not-sent" ? "warning" : "muted", `提示 ${PROMPT_LABELS[row.promptStatus]}`)}${sep(theme)}${theme.fg(row.metricsStatus === "hit" ? "success" : row.metricsStatus === "unknown" ? "warning" : "muted", `指标 ${METRICS_LABELS[row.metricsStatus]}`)}`,
		));
		lines.push(kv(theme, "▹", "判断", theme.fg(row.metricsStatus === "unknown" ? "warning" : "text", row.conclusion)));
	}
	await runInfoPage(ctx, {
		title: "缓存诊断",
		titleRight: `最近 ${rows.length} 轮`,
		lines,
		reserved: 12,
	});
}
