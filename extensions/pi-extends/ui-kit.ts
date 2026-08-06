/**
 * pi-extends 共享 TUI 套件。
 *
 * 所有交互界面都通过 ctx.ui.custom() 接管键盘焦点，渲染成一张「无边框卡片」：
 *   ● 标题 ····· 右侧小字 → 状态区 → 主体（菜单 / 文本）→ 单行按键提示
 * 不画方框，改用缩进 + 空行 + 主题色分层来分区，贴在对话流里像一条普通消息，
 * 而不是一个突然弹出的窗口。颜色一律取自当前主题的语义 token（accent /
 * borderMuted / muted / dim …），不硬编码 ANSI，因此切换主题即刻跟随变色。
 */

import type { ExtensionCommandContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { fuzzyFilter, Input, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** 卡片最大宽度：终端更宽时留白，避免菜单被拉成一条长线。 */
const MAX_CARD_WIDTH = 96;
/** 卡片左侧留白，正文都缩进这么多列。 */
const CARD_PAD = 2;
/** 主体最少可见行数。 */
const MIN_VISIBLE_ROWS = 4;
/** 主体最多可见行数。 */
const MAX_VISIBLE_ROWS = 16;

/** 截断或补齐到精确的显示宽度（CJK / emoji / ANSI 安全）。 */
export function padTo(text: string, width: number, ellipsis = "…"): string {
	if (width <= 0) {
		return "";
	}
	let out = visibleWidth(text) > width ? truncateToWidth(text, width, ellipsis) : text;
	const w = visibleWidth(out);
	if (w < width) {
		out += " ".repeat(width - w);
	}
	return out;
}

/** 左右两端对齐成一行，中间用空格填充。 */
export function splitRow(left: string, right: string, width: number): string {
	const rightWidth = visibleWidth(right);
	if (rightWidth >= width) {
		return padTo(right, width);
	}
	return padTo(left, width - rightWidth) + right;
}

/** 计算主体可见行数：按终端高度自适应，给对话区留出空间。 */
export function visibleRows(tui: TUI, reserved = 12): number {
	const rows = tui.terminal?.rows ?? 24;
	return Math.max(MIN_VISIBLE_ROWS, Math.min(MAX_VISIBLE_ROWS, rows - reserved));
}

/** 方括号徽标，用于「已认证 / 未配置 / 只读」这类短状态。 */
export function badge(theme: Theme, text: string, tone: ThemeColor = "accent"): string {
	return theme.fg(tone, `[${text}]`);
}

/** 横向进度条，用于上下文占比、轮次配额等比例量。 */
export function gauge(
	theme: Theme,
	ratio: number,
	width = 10,
	tone: ThemeColor = "accent",
): string {
	const safe = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
	const filled = Math.round(safe * width);
	return (
		theme.fg(tone, "━".repeat(filled)) +
		theme.fg("borderMuted", "━".repeat(Math.max(0, width - filled)))
	);
}

/** 状态区的一行「标签 + 值」，标签列定宽以便多行对齐。 */
export function kv(theme: Theme, icon: string, label: string, value: string): string {
	return `${theme.fg("accent", icon)} ${theme.fg("dim", padTo(label, 8))} ${value}`;
}

export interface KeyHint {
	key: string;
	label: string;
}

/** 底部按键提示栏。 */
export function renderHints(theme: Theme, hints: KeyHint[]): string {
	return hints
		.map((h) => `${theme.fg("accent", h.key)} ${theme.fg("dim", h.label)}`)
		.join(theme.fg("borderMuted", "  ·  "));
}

export interface CardOptions {
	title: string;
	/** 标题行右端的小字，通常放主题名、版本、当前目录。 */
	titleRight?: string;
	/** 标题下方的状态行，每次渲染都会重新求值。 */
	status?: () => string[];
	/** 底部按键提示。 */
	hints?: () => KeyHint[];
	body: Component;
	maxWidth?: number;
}

/**
 * 无边框卡片：`● 标题` 一行、状态区、主体、提示行，靠缩进和空行分区。
 * 每一行都补齐到卡片宽度，这样菜单选中行整行反色才不会出现锯齿。
 */
export class Card implements Component {
	private readonly theme: Theme;
	private readonly opts: CardOptions;

	constructor(theme: Theme, opts: CardOptions) {
		this.theme = theme;
		this.opts = opts;
	}

	invalidate(): void {
		this.opts.body.invalidate();
	}

	handleInput(data: string): void {
		this.opts.body.handleInput?.(data);
	}

	render(viewport: number): string[] {
		const theme = this.theme;
		const width = Math.max(24, Math.min(viewport, this.opts.maxWidth ?? MAX_CARD_WIDTH));
		const inner = width - CARD_PAD;
		const pad = " ".repeat(CARD_PAD);
		const out: string[] = [pad + this.renderTitle(inner)];

		const status = this.opts.status?.() ?? [];
		for (const line of status) {
			out.push(pad + padTo(line, inner));
		}
		for (const line of this.opts.body.render(inner)) {
			out.push(pad + padTo(line, inner));
		}
		const hints = this.opts.hints?.() ?? [];
		if (hints.length > 0) {
			out.push(pad + padTo(renderHints(theme, hints), inner));
		}
		return out;
	}

	private renderTitle(inner: number): string {
		const theme = this.theme;
		const bullet = theme.fg("accent", "●");
		const title = theme.bold(theme.fg("text", this.opts.title));
		const right = this.opts.titleRight;
		return splitRow(
			`${bullet} ${title}`,
			right ? theme.fg("dim", right) : "",
			inner,
		);
	}
}

/** 右对齐补齐到指定宽度。 */
/**
 * 按显示宽度换行，CJK 按 2 列计算。优先在空白处断行，单词超长时硬断。
 * 只处理无 ANSI 的纯文本 —— 转录区的卡片是先换行再着色的。
 */
export function wrapText(text: string, width: number): string[] {
	if (width <= 0) {
		return [];
	}
	const out: string[] = [];
	for (const paragraph of text.split("\n")) {
		if (paragraph.trim() === "") {
			out.push("");
			continue;
		}
		let line = "";
		for (const token of paragraph.match(/\s+|\S+/g) ?? []) {
			if (/^\s+$/.test(token)) {
				if (line !== "" && visibleWidth(line) < width) {
					line += " ";
				}
				continue;
			}
			let word = token;
			while (visibleWidth(word) > width) {
				// 单个词就超过一行：先填满当前行，剩下的继续切。
				const room = width - visibleWidth(line);
				let head = "";
				let rest = word;
				while (rest.length > 0 && visibleWidth(head + rest[0]) <= room) {
					head += rest[0];
					rest = rest.slice(1);
				}
				if (head === "") {
					out.push(line.trimEnd());
					line = "";
					continue;
				}
				out.push((line + head).trimEnd());
				line = "";
				word = rest;
			}
			if (line !== "" && visibleWidth(line + word) > width) {
				out.push(line.trimEnd());
				line = "";
			}
			line += word;
		}
		out.push(line.trimEnd());
	}
	return out;
}

export function padStartTo(text: string, width: number, ellipsis = "…"): string {
	if (width <= 0) {
		return "";
	}
	const out = visibleWidth(text) > width ? truncateToWidth(text, width, ellipsis) : text;
	const w = visibleWidth(out);
	return w < width ? " ".repeat(width - w) + out : out;
}

export interface MenuItem {
	id: string;
	label: string;
	/** 行首图标，一到两列宽。 */
	icon?: string;
	/** 灰色说明文字。 */
	hint?: string;
	/** 右端当前值，用于「设置项 → 当前配置」这种展示。 */
	value?: string;
	/** 数字/字母直达键。 */
	hotkey?: string;
	/** 分组标题，相邻同组只渲染一次。 */
	group?: string;
	/** 覆盖标签颜色，用于危险项（error）或已启用项（success）。 */
	tone?: ThemeColor;
	/** 多选模式下的勾选状态。 */
	checked?: boolean;
	/** 搜索时额外参与匹配的关键字。 */
	keywords?: string;
}

export interface MenuColumns {
	hotkey: number;
	check: number;
	label: number;
	value: number;
	/** 数值列右侧的空白，让内容块靠左成团而不是被拉到卡片边缘。 */
	trail: number;
}

function labelOf(item: MenuItem): string {
	return item.icon ? `${item.icon} ${item.label}` : item.label;
}

/**
 * 计算菜单各列宽度，使 `2 + hotkey + check + label + 2 + value + trail` 恰好等于内容宽度。
 * 宽终端下标签与数值只占各自需要的宽度，多出来的空间全部留到行尾，
 * 内容因此成团靠左；窄终端下压缩标签列。说明文字不占列，只在选中行下方单独一行展示。
 */
export function menuColumns(items: MenuItem[], inner: number, multi = false): MenuColumns {
	const hotkey = items.some((i) => i.hotkey) ? 3 : 0;
	const check = multi ? 4 : 0;
	const gutter = 2 + hotkey + check;
	const avail = Math.max(0, inner - gutter);
	const labelNeeded = items.reduce((max, i) => Math.max(max, visibleWidth(labelOf(i))), 0);
	const valueNeeded = items.reduce(
		(max, i) => Math.max(max, i.value ? visibleWidth(i.value) : 0),
		0,
	);
	const gap = valueNeeded > 0 ? 2 : 0;
	if (labelNeeded + gap + valueNeeded <= avail) {
		return {
			hotkey,
			check,
			label: labelNeeded,
			value: valueNeeded,
			trail: avail - labelNeeded - gap - valueNeeded,
		};
	}
	const value = valueNeeded === 0 ? 0 : Math.min(valueNeeded, Math.floor(avail * 0.4));
	return {
		hotkey,
		check,
		label: Math.max(0, avail - (value > 0 ? value + 2 : 0)),
		value,
		trail: 0,
	};
}

function isPrintable(data: string): boolean {
	if (data.length === 0 || data.startsWith("\x1b")) {
		return false;
	}
	for (const ch of data) {
		const code = ch.codePointAt(0) ?? 0;
		if (code < 0x20 || code === 0x7f) {
			return false;
		}
	}
	return true;
}

type DisplayRow =
	| { type: "group"; text: string }
	| { type: "item"; item: MenuItem; index: number }
	| { type: "hint"; text: string }
	| { type: "blank" };

export interface MenuListOptions {
	items: MenuItem[];
	maxVisible: number;
	/** 多选模式：空格勾选，回车确认。 */
	multi?: boolean;
	/** hotkey：按 / 进入搜索；always：直接输入即搜索；off：禁用搜索。 */
	search?: "hotkey" | "always" | "off";
	initialId?: string;
	emptyText?: string;
	onSelect(item: MenuItem): void;
	onCancel(): void;
	onConfirm?(ids: string[]): void;
	/** 光标移动时回调，用于主题实时预览这类即时反馈。 */
	onHighlight?(item: MenuItem): void;
}

/** 可搜索、可分组、可多选的菜单列表。 */
export class MenuList implements Component {
	private readonly theme: Theme;
	private readonly tui: TUI;
	private readonly keys: KeybindingsManager;
	private readonly opts: MenuListOptions;
	private items: MenuItem[];
	private filtered: MenuItem[];
	private selected = 0;
	private query = "";
	private searching: boolean;
	private readonly checked = new Set<string>();

	constructor(theme: Theme, tui: TUI, keys: KeybindingsManager, opts: MenuListOptions) {
		this.theme = theme;
		this.tui = tui;
		this.keys = keys;
		this.opts = opts;
		this.items = opts.items;
		this.filtered = opts.items;
		this.searching = opts.search === "always";
		for (const item of opts.items) {
			if (item.checked) {
				this.checked.add(item.id);
			}
		}
		const index = opts.initialId ? opts.items.findIndex((i) => i.id === opts.initialId) : -1;
		this.selected = index >= 0 ? index : 0;
	}

	invalidate(): void {}

	getChecked(): string[] {
		return this.items.filter((i) => this.checked.has(i.id)).map((i) => i.id);
	}

	private current(): MenuItem | undefined {
		return this.filtered[this.selected];
	}

	private moveTo(index: number): void {
		if (this.filtered.length === 0) {
			return;
		}
		this.selected = Math.max(0, Math.min(this.filtered.length - 1, index));
		const item = this.current();
		if (item) {
			this.opts.onHighlight?.(item);
		}
		this.tui.requestRender();
	}

	private move(delta: number): void {
		if (this.filtered.length === 0) {
			return;
		}
		const next = this.selected + delta;
		const wrapped =
			Math.abs(delta) === 1
				? (next + this.filtered.length) % this.filtered.length
				: Math.max(0, Math.min(this.filtered.length - 1, next));
		this.moveTo(wrapped);
	}

	private toggle(): void {
		const item = this.current();
		if (!item) {
			return;
		}
		if (this.checked.has(item.id)) {
			this.checked.delete(item.id);
		} else {
			this.checked.add(item.id);
		}
		this.tui.requestRender();
	}

	private applyFilter(): void {
		const keepId = this.current()?.id;
		this.filtered = this.query
			? fuzzyFilter(
					this.items,
					this.query,
					(i) => `${i.label} ${i.hint ?? ""} ${i.value ?? ""} ${i.keywords ?? ""}`,
				)
			: this.items;
		const index = keepId ? this.filtered.findIndex((i) => i.id === keepId) : -1;
		this.selected = index >= 0 ? index : 0;
	}

	handleInput(data: string): void {
		const keys = this.keys;
		if (keys.matches(data, "tui.select.cancel")) {
			if (this.query) {
				this.query = "";
				this.applyFilter();
			} else if (this.searching && this.opts.search === "hotkey") {
				this.searching = false;
			} else {
				this.opts.onCancel();
				return;
			}
			this.tui.requestRender();
			return;
		}
		if (keys.matches(data, "tui.select.confirm")) {
			if (this.opts.multi) {
				this.opts.onConfirm?.(this.getChecked());
				return;
			}
			const item = this.current();
			if (item) {
				this.opts.onSelect(item);
			}
			return;
		}
		if (keys.matches(data, "tui.select.up") || (!this.searching && data === "k")) {
			this.move(-1);
			return;
		}
		if (keys.matches(data, "tui.select.down") || (!this.searching && data === "j")) {
			this.move(1);
			return;
		}
		if (keys.matches(data, "tui.select.pageUp")) {
			this.move(-this.opts.maxVisible);
			return;
		}
		if (keys.matches(data, "tui.select.pageDown")) {
			this.move(this.opts.maxVisible);
			return;
		}
		if (this.opts.multi && data === " ") {
			this.toggle();
			return;
		}
		if (!this.searching) {
			const hit = this.filtered.find((i) => i.hotkey === data);
			if (hit) {
				this.moveTo(this.filtered.indexOf(hit));
				if (this.opts.multi) {
					this.toggle();
				} else {
					this.opts.onSelect(hit);
				}
				return;
			}
			if (this.opts.search === "hotkey" && data === "/") {
				this.searching = true;
				this.tui.requestRender();
				return;
			}
		}
		if (this.opts.search === "off") {
			return;
		}
		if (data === "\x7f" || data === "\b") {
			if (this.query) {
				this.query = Array.from(this.query).slice(0, -1).join("");
				this.applyFilter();
				this.tui.requestRender();
			}
			return;
		}
		if (this.searching && isPrintable(data)) {
			this.query += data;
			this.applyFilter();
			this.tui.requestRender();
		}
	}

	private buildDisplay(): DisplayRow[] {
		const rows: DisplayRow[] = [];
		let group: string | undefined;
		this.filtered.forEach((item, index) => {
			if (item.group && item.group !== group) {
				if (rows.length > 0) {
					rows.push({ type: "blank" });
				}
				rows.push({ type: "group", text: item.group });
			}
			group = item.group;
			rows.push({ type: "item", item, index });
			if (index === this.selected && item.hint) {
				rows.push({ type: "hint", text: item.hint });
			}
		});
		return rows;
	}

	/** 分组标题：不画横线，只用一行暗色小字带出层级。 */
	private renderGroup(text: string): string {
		return `  ${this.theme.fg("dim", text)}`;
	}

	/** 选中项的说明文字，缩进对齐到标签列。 */
	private renderHint(text: string, indent: number): string {
		return `${" ".repeat(indent)}${this.theme.fg("muted", text)}`;
	}

	private renderItem(
		item: MenuItem,
		selected: boolean,
		cols: MenuColumns,
		inner: number,
	): string {
		const theme = this.theme;
		const cursor = selected ? theme.fg("accent", "› ") : "  ";
		const hotkey = cols.hotkey
			? `${theme.fg(selected ? "accent" : "borderMuted", padTo(item.hotkey ?? "", cols.hotkey - 1))} `
			: "";
		const check = cols.check
			? this.checked.has(item.id)
				? theme.fg("success", "[✓] ")
				: theme.fg("borderMuted", "[ ] ")
			: "";
		const tone: ThemeColor = item.tone ?? (selected ? "accent" : "text");
		const labelText = padTo(labelOf(item), cols.label);
		const label = selected
			? theme.bold(theme.fg(tone, labelText))
			: theme.fg(tone, labelText);
		const value =
			cols.value > 0
				? `  ${theme.fg(selected ? "text" : "dim", padStartTo(item.value ?? "", cols.value))}`
				: "";
		const row = `${cursor}${hotkey}${check}${label}${value}`;
		return selected ? theme.bg("selectedBg", padTo(row, inner)) : row;
	}

	render(inner: number): string[] {
		const theme = this.theme;
		const lines: string[] = [];
		if (this.searching || this.query) {
			lines.push(
				splitRow(
					`${theme.fg("dim", "搜索")} ${theme.fg("text", this.query)}${theme.fg("accent", "▏")}`,
					theme.fg("dim", `${this.filtered.length}/${this.items.length}`),
					inner,
				),
			);
		}
		lines.push("");
		if (this.filtered.length === 0) {
			lines.push(`  ${theme.fg("warning", this.opts.emptyText ?? "没有匹配项")}`, "");
			return lines;
		}
		const cols = menuColumns(this.filtered, inner, this.opts.multi ?? false);
		const indent = 2 + cols.hotkey + cols.check;
		const display = this.buildDisplay();
		const cursorAt = display.findIndex((r) => r.type === "item" && r.index === this.selected);
		const max = this.opts.maxVisible;
		const start =
			display.length > max
				? Math.max(0, Math.min(cursorAt - Math.floor(max / 2), display.length - max))
				: 0;
		const end = Math.min(display.length, start + max);
		for (let i = start; i < end; i++) {
			const row = display[i];
			if (!row) {
				continue;
			}
			if (row.type === "blank") {
				lines.push("");
			} else if (row.type === "group") {
				lines.push(this.renderGroup(row.text));
			} else if (row.type === "hint") {
				lines.push(this.renderHint(row.text, indent));
			} else {
				lines.push(this.renderItem(row.item, row.index === this.selected, cols, inner));
			}
		}
		if (display.length > max) {
			lines.push(
				splitRow(
					theme.fg("borderMuted", `  ${start > 0 ? "▲" : " "}${end < display.length ? "▼" : " "}`),
					theme.fg("dim", `${this.selected + 1}/${this.filtered.length}`),
					inner,
				),
			);
		}
		lines.push("");
		return lines;
	}
}

/** 任何持有 ui 的上下文都能驱动本套件（命令上下文与事件上下文都满足）。 */
export interface UiHost {
	ui: ExtensionCommandContext["ui"];
}

export interface MenuSpec {
	title: string;
	titleRight?: string;
	status?: (theme: Theme) => string[];
	hints?: KeyHint[];
	items: MenuItem[];
	search?: "hotkey" | "always" | "off";
	initialId?: string;
	emptyText?: string;
	maxWidth?: number;
	/** 给对话区预留的行数，越大则菜单越矮。 */
	reserved?: number;
	/** 光标移动回调，用于实时预览。 */
	onHighlight?(id: string): void;
}

function defaultHints(spec: MenuSpec, multi: boolean): KeyHint[] {
	const hints: KeyHint[] = [{ key: "↑↓", label: "移动" }];
	if (multi) {
		hints.push({ key: "空格", label: "勾选" }, { key: "⏎", label: "保存" });
	} else {
		hints.push({ key: "⏎", label: "选择" });
	}
	if (spec.items.some((i) => i.hotkey)) {
		hints.push({ key: "1-9", label: "直达" });
	}
	if ((spec.search ?? "hotkey") === "hotkey") {
		hints.push({ key: "/", label: "搜索" });
	}
	hints.push({ key: "esc", label: "返回" });
	return hints;
}

function cardFor(
	theme: Theme,
	spec: MenuSpec,
	body: Component,
	multi: boolean,
): Card {
	return new Card(theme, {
		title: spec.title,
		titleRight: spec.titleRight,
		status: spec.status ? () => spec.status?.(theme) ?? [] : undefined,
		hints: () => spec.hints ?? defaultHints(spec, multi),
		maxWidth: spec.maxWidth,
		body,
	});
}

/** 单选菜单：返回选中项 id，Esc 返回 undefined。 */
export function runMenu(host: UiHost, spec: MenuSpec): Promise<string | undefined> {
	return host.ui.custom<string | undefined>((tui, theme, keybindings, done) => {
		const menu = new MenuList(theme, tui, keybindings, {
			items: spec.items,
			maxVisible: visibleRows(tui, spec.reserved),
			search: spec.search ?? "hotkey",
			initialId: spec.initialId,
			emptyText: spec.emptyText,
			onSelect: (item) => done(item.id),
			onCancel: () => done(undefined),
			onHighlight: spec.onHighlight ? (item) => spec.onHighlight?.(item.id) : undefined,
		});
		return cardFor(theme, spec, menu, false);
	});
}

/** 多选菜单：返回勾选的 id 列表，Esc 返回 undefined。 */
export function runToggleList(host: UiHost, spec: MenuSpec): Promise<string[] | undefined> {
	return host.ui.custom<string[] | undefined>((tui, theme, keybindings, done) => {
		const menu = new MenuList(theme, tui, keybindings, {
			items: spec.items,
			maxVisible: visibleRows(tui, spec.reserved),
			multi: true,
			search: spec.search ?? "off",
			initialId: spec.initialId,
			emptyText: spec.emptyText,
			onSelect: () => {},
			onConfirm: (ids) => done(ids),
			onCancel: () => done(undefined),
		});
		return cardFor(theme, spec, menu, true);
	});
}

/** 可滚动的只读文本主体：任意其他按键关闭。 */
class TextBlock implements Component {
	private readonly theme: Theme;
	private readonly tui: TUI;
	private readonly keys: KeybindingsManager;
	private readonly lines: string[];
	private readonly maxVisible: number;
	private readonly onClose: () => void;
	private offset = 0;

	constructor(
		theme: Theme,
		tui: TUI,
		keys: KeybindingsManager,
		lines: string[],
		maxVisible: number,
		onClose: () => void,
	) {
		this.theme = theme;
		this.tui = tui;
		this.keys = keys;
		this.lines = lines;
		this.maxVisible = maxVisible;
		this.onClose = onClose;
	}

	invalidate(): void {}

	handleInput(data: string): void {
		const maxOffset = Math.max(0, this.lines.length - this.maxVisible);
		if (this.keys.matches(data, "tui.select.up")) {
			this.offset = Math.max(0, this.offset - 1);
		} else if (this.keys.matches(data, "tui.select.down")) {
			this.offset = Math.min(maxOffset, this.offset + 1);
		} else if (this.keys.matches(data, "tui.select.pageUp")) {
			this.offset = Math.max(0, this.offset - this.maxVisible);
		} else if (this.keys.matches(data, "tui.select.pageDown")) {
			this.offset = Math.min(maxOffset, this.offset + this.maxVisible);
		} else {
			this.onClose();
			return;
		}
		this.tui.requestRender();
	}

	render(inner: number): string[] {
		const max = this.maxVisible;
		const maxOffset = Math.max(0, this.lines.length - max);
		this.offset = Math.min(this.offset, maxOffset);
		const view = this.lines.slice(this.offset, this.offset + max);
		const out = ["", ...view.map((line) => `  ${line}`)];
		if (this.lines.length > max) {
			out.push(
				splitRow(
					"",
					this.theme.fg("dim", `${this.offset + 1}-${this.offset + view.length} / ${this.lines.length}`),
					inner,
				),
			);
		}
		out.push("");
		return out;
	}
}

export interface InfoSpec {
	title: string;
	titleRight?: string;
	lines: string[];
	hints?: KeyHint[];
	maxWidth?: number;
	reserved?: number;
}

/** 只读信息页，用于状态总览、认证详情这类展示。 */
export function runInfoPage(host: UiHost, spec: InfoSpec): Promise<void> {
	return host.ui.custom<void>((tui, theme, keybindings, done) => {
		const block = new TextBlock(
			theme,
			tui,
			keybindings,
			spec.lines,
			visibleRows(tui, spec.reserved),
			() => done(undefined as void),
		);
		return new Card(theme, {
			title: spec.title,
			titleRight: spec.titleRight,
			hints: () => spec.hints ?? [{ key: "↑↓", label: "滚动" }, { key: "任意键", label: "返回" }],
			maxWidth: spec.maxWidth,
			body: block,
		});
	});
}

/** 单行输入主体：把 pi-tui 的 Input 摆进卡片里，保持焦点与光标位置。 */
class PromptBody implements Component {
	readonly input = new Input();
	private readonly theme: Theme;
	private readonly label: string | undefined;

	constructor(theme: Theme, label: string | undefined, initial: string) {
		this.theme = theme;
		this.label = label;
		this.input.focused = true;
		if (initial) {
			this.input.setValue(initial);
		}
	}

	invalidate(): void {
		this.input.invalidate();
	}

	handleInput(data: string): void {
		this.input.handleInput(data);
	}

	render(inner: number): string[] {
		const out: string[] = [""];
		if (this.label) {
			out.push(`  ${this.theme.fg("dim", this.label)}`, "");
		}
		out.push(...this.input.render(Math.max(4, inner - 2)).map((line) => `  ${line}`), "");
		return out;
	}
}

export interface PromptSpec {
	title: string;
	titleRight?: string;
	label?: string;
	initial?: string;
	hints?: KeyHint[];
	maxWidth?: number;
}

/** 单行输入框：返回输入内容，Esc 返回 undefined。 */
export function runPrompt(host: UiHost, spec: PromptSpec): Promise<string | undefined> {
	return host.ui.custom<string | undefined>((tui, theme, _keybindings, done) => {
		const body = new PromptBody(theme, spec.label, spec.initial ?? "");
		body.input.onSubmit = (value) => done(value);
		body.input.onEscape = () => done(undefined);
		return new Card(theme, {
			title: spec.title,
			titleRight: spec.titleRight,
			hints: () => spec.hints ?? [{ key: "⏎", label: "确认" }, { key: "esc", label: "取消" }],
			maxWidth: spec.maxWidth,
			body,
		});
	});
}
