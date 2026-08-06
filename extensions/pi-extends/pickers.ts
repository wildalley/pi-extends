/**
 * 模型 / thinking / 工具选择器。
 *
 * 抽成独立模块，供 cockpit 与 roles 共用：两边都需要同一套选择器，
 * 若互相 import 会形成循环依赖。
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext, ThemeColor } from "@earendil-works/pi-coding-agent";
import { BUILTIN_TOOLS, THINKING_LEVELS, isValidThinkingLevel, type ThinkingLevel } from "./config.ts";
import { runMenu, runToggleList, type MenuItem } from "./ui-kit.ts";

export const THINKING_HINTS: Record<ThinkingLevel, string> = {
	off: "不分配思考预算，最省 token",
	minimal: "极少思考，响应最快",
	low: "少量思考，适合机械改动",
	medium: "平衡档，日常默认",
	high: "深入思考，适合设计与排错",
	xhigh: "更深入，代价更高",
	max: "最大预算，留给最难的问题",
};

export const TOOL_HINTS: Record<string, string> = {
	read: "读取文件",
	grep: "按内容搜索",
	find: "按文件名搜索",
	ls: "列目录",
	bash: "执行命令（写权限）",
	edit: "修改文件（写权限）",
	write: "创建/覆盖文件（写权限）",
};

const WRITE_TOOLS = new Set(["bash", "edit", "write"]);
const READONLY_TOOLS = ["read", "grep", "find", "ls"];

export function modelIdOf(m: Model<any>): string {
	return `${m.provider}/${m.id}`;
}

export function findModelById(
	ctx: ExtensionCommandContext,
	id: string,
): Model<any> | undefined {
	return ctx.modelRegistry.getAll().find((m) => modelIdOf(m) === id);
}

/** 去掉 provider 前缀，状态区里用短名更省宽度。 */
export function shortModel(id: string): string {
	const slash = id.indexOf("/");
	return slash >= 0 ? id.slice(slash + 1) : id;
}

export function fmtTokens(n: number): string {
	if (!Number.isFinite(n) || n <= 0) return "0";
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 10_000) return `${Math.round(n / 1000)}k`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

/** thinking 等级对应主题里的 thinkingXxx 语义色。 */
export function thinkingTone(level: ThinkingLevel): ThemeColor {
	return `thinking${level.charAt(0).toUpperCase()}${level.slice(1)}` as ThemeColor;
}

export function modelHint(m: Model<any>): string {
	const parts: string[] = [];
	if (typeof m.contextWindow === "number" && m.contextWindow > 0) {
		parts.push(`${fmtTokens(m.contextWindow)} ctx`);
	}
	if (m.reasoning) parts.push("reasoning");
	if (Array.isArray(m.input) && m.input.includes("image")) parts.push("image");
	return parts.join(" · ");
}

/**
 * 模型选择器：按厂商分组，右列显示认证状态，`a` 在「仅已认证 / 全部」之间切换。
 * 返回 `provider/id` 形式的模型 id。
 */
export async function pickModelId(
	ctx: ExtensionCommandContext,
	title: string,
	current?: string,
): Promise<string | undefined> {
	let showAll = false;
	while (true) {
		const all = ctx.modelRegistry.getAll();
		const visible = all.filter((m) => showAll || ctx.modelRegistry.hasConfiguredAuth(m));
		const sorted = visible
			.slice()
			.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
		const items: MenuItem[] = sorted.map((m) => {
			const id = modelIdOf(m);
			const authed = ctx.modelRegistry.hasConfiguredAuth(m);
			return {
				id,
				group: ctx.modelRegistry.getProviderDisplayName(m.provider),
				icon: id === current ? "◉" : "○",
				label: m.id,
				value: authed ? "已认证" : "未认证",
				tone: authed ? undefined : "muted",
				hint: modelHint(m),
				keywords: `${m.provider} ${m.name}`,
			};
		});
		items.push({
			id: showAll ? "__authed" : "__all",
			group: "视图",
			icon: "▸",
			label: showAll ? "仅显示已认证模型" : `显示全部模型（${all.length}）`,
			hotkey: "a",
		});
		const picked = await runMenu(ctx, {
			title,
			titleRight: `${showAll ? "全部" : "已认证"} ${sorted.length}`,
			items,
			initialId: current,
			emptyText: "没有已认证的模型。按 a 查看全部，或先到「厂商与认证」完成登录。",
		});
		if (picked === undefined) return undefined;
		if (picked === "__all" || picked === "__authed") {
			showAll = !showAll;
			continue;
		}
		return picked;
	}
}

/** thinking 等级选择器，每档按自身语义色着色。 */
export async function pickThinking(
	ctx: ExtensionCommandContext,
	title: string,
	current: ThinkingLevel,
	extra?: { inheritLabel: string },
): Promise<ThinkingLevel | "__inherit" | undefined> {
	const items: MenuItem[] = THINKING_LEVELS.map((lvl, i) => ({
		id: lvl,
		icon: lvl === current ? "◉" : "○",
		label: lvl,
		hotkey: String(i + 1),
		tone: thinkingTone(lvl),
		hint: THINKING_HINTS[lvl],
	}));
	if (extra) {
		items.push({ id: "__inherit", icon: "▸", label: extra.inheritLabel, hotkey: "0", tone: "muted" });
	}
	const picked = await runMenu(ctx, {
		title,
		titleRight: `当前 ${current}`,
		items,
		initialId: current,
	});
	if (picked === undefined) return undefined;
	if (picked === "__inherit") return "__inherit";
	return isValidThinkingLevel(picked) ? picked : undefined;
}

/** 工具权限多选：空格勾选，回车保存；写权限工具用 warning 色标出。 */
export async function pickToolSet(
	ctx: ExtensionCommandContext,
	title: string,
	current: string[],
): Promise<string[] | undefined> {
	const set = new Set(current);
	const items: MenuItem[] = BUILTIN_TOOLS.map((t, i) => ({
		id: t,
		label: t,
		checked: set.has(t),
		hotkey: String(i + 1),
		tone: WRITE_TOOLS.has(t) ? "warning" : undefined,
		hint: TOOL_HINTS[t] ?? "",
		value: WRITE_TOOLS.has(t) ? "写" : "只读",
	}));
	return runToggleList(ctx, {
		title,
		titleRight: `已选 ${set.size}/${BUILTIN_TOOLS.length}`,
		items,
	});
}

/** 只读工具预设，供「限为只读」这类一键操作使用。 */
export function readonlyToolSet(): string[] {
	return [...READONLY_TOOLS];
}
