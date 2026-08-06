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
import { MOUSE_OFF, MOUSE_ON, parseMouse } from "./mouse.ts";

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

/**
 * 选中行上不可读的前景色，及其替代色。
 *
 * 选中行会铺 `selectedBg`，但 tone 还是原来那个暗色，于是「灰字 + 亮底」变成一团糊。
 * 实测这三个 token 在全部 5 套主题里对 selectedBg 的 WCAG 对比度：
 *   borderMuted 1.10–1.42:1、thinkingOff 1.10–2.01:1、dim 2.49–4.91:1。
 * 前两个基本等于看不见，dim 在 pi-carbon / pi-sakura / pi-terminal 下过不了 AA。
 *
 * 这里统一换成 `text`：这几个 token 的语义都只是「弱化」，而行已经被选中高亮了，
 * 弱化本身没有信息量，换掉不丢东西。`muted`（4.55–8.07:1）和 `error`/`warning`/
 * `success` 都够亮或带语义，保持原样。
 */
const LOW_CONTRAST_ON_SELECTED = new Set<ThemeColor>(["dim", "thinkingOff", "borderMuted"]);

/** 选中行用的 tone：把在 selectedBg 上读不清的换成 `text`。 */
export function onSelectedBg(tone: ThemeColor, selected: boolean): ThemeColor {
	return selected && LOW_CONTRAST_ON_SELECTED.has(tone) ? "text" : tone;
}

/** 方括号徽标，用于「已认证 / 未配置 / 只读」这类短状态。 */
export function badge(theme: Theme, text: string, tone: ThemeColor = "accent"): string {
	return theme.fg(tone, `[${text}]`);
}

/**
 * 同一行里并列几段信息时用的分隔点。
 *
 * 别再用 `borderMuted`：实测它对各主题自己的背景只有 1.30–2.48:1
 * （pi-carbon 1.36、pi-sakura 1.30），也就是画了等于没画，一行里几段信息会糊成一句话。
 * `dim` 是 4.29–8.63:1，看得见但仍比正文轻。分隔点两侧的内容因此不该也用 `dim`，
 * 否则分不出哪个是内容哪个是间隔 —— 状态行的值请用 `muted` 或更亮。
 */
export function sep(theme: Theme, wide = true): string {
	return theme.fg("dim", wide ? "  ·  " : " · ");
}

/**
 * 横向进度条，用于上下文占比、轮次配额等比例量。
 *
 * 实心段和空槽用密度不同的两个字符（`█` / `░`）而不是同一个字符换颜色：
 * 两段同形不同色时，一旦背景色偏亮或用户改了调色板，就分不出填到哪儿了。
 * 两者都取自 Block Elements，不碰 box drawing —— 卡片本身是无边框的，
 * 混进 `─` 会让「这张卡有没有画边框」不再能靠字符判断（见 ui-kit-render 的边框测试）。
 */
export function gauge(
	theme: Theme,
	ratio: number,
	width = 10,
	tone: ThemeColor = "accent",
): string {
	const safe = Number.isFinite(ratio) ? Math.max(0, Math.min(1, ratio)) : 0;
	const filled = Math.round(safe * width);
	return (
		theme.fg(tone, "█".repeat(filled)) +
		theme.fg("dim", "░".repeat(Math.max(0, width - filled)))
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
		// 说明文字用 muted 而不是 dim：分隔点已经占了 dim，两者同色就分不出
		// 「这是一组 键+说明」还是「这是一串平铺的词」。
		.map((h) => `${theme.fg("accent", h.key)} ${theme.fg("muted", h.label)}`)
		.join(sep(theme));
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
	/**
	 * 把每一行补齐到整个视口宽度（内容仍按 maxWidth 排版）。
	 *
	 * overlay 模式必须开：overlay 只覆盖它自己那几列，卡片窄于终端时
	 * 两侧会漏出底下的对话内容，看起来像乱码。
	 */
	fillWidth?: boolean;
}

/**
 * 无边框卡片：`● 标题` 一行、状态区、主体、提示行，靠缩进和空行分区。
 * 每一行都补齐到卡片宽度，这样菜单选中行整行反色才不会出现锯齿。
 */
export class Card implements Component {
	private readonly theme: Theme;
	private readonly opts: CardOptions;
	/** 主体第一行在卡片里的行号，由上一次 render 记下。鼠标坐标换算要用。 */
	private bodyOffset = 0;

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

	/**
	 * 把卡片内的坐标转成主体坐标后交给主体。
	 *
	 * 偏移量取自上一次 render 记下的实际值，而不是重新数一遍标题和状态行 ——
	 * 状态行数量每帧都可能变（status() 是回调），重算出来的第二份迟早对不上。
	 */
	clickAt(row: number, col: number): boolean {
		const body = this.opts.body as Component & { clickAt?(r: number, c: number): boolean };
		if (!body.clickAt) {
			return false;
		}
		const bodyRow = row - this.bodyOffset;
		if (bodyRow < 0) {
			return false;
		}
		return body.clickAt(bodyRow, col - CARD_PAD);
	}

	scrollBy(delta: number): void {
		const body = this.opts.body as Component & { scrollBy?(d: number): void };
		body.scrollBy?.(delta);
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
		if (status.length > 0) {
			// 状态区和主体之间留一行。没有这行时标题、状态、tab 条会挤成一整块，
			// 眼睛要停一下才能看出「从哪里开始是可以操作的东西」。
			out.push(pad + padTo("", inner));
		}
		this.bodyOffset = out.length;
		for (const line of this.opts.body.render(inner)) {
			out.push(pad + padTo(line, inner));
		}
		const hints = this.opts.hints?.() ?? [];
		if (hints.length > 0) {
			// 空行也要补齐到卡片宽度：卡片的每一行等宽是选中行整行反色不出锯齿的前提。
			out.push(pad + padTo("", inner));
			out.push(pad + padTo(renderHints(theme, hints), inner));
		}
		// overlay 只覆盖自己那几列，窄于终端时两侧会漏出对话内容。
		if (this.opts.fillWidth && viewport > width) {
			return out.map((line) => padTo(line, viewport));
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
	| { type: "blank" };

/**
 * 一行的可点击目标。render 时按输出顺序记下来，鼠标事件再反查。
 *
 * 这样点击映射不需要复算布局 —— 布局逻辑只有 render 一份，
 * 复算出来的第二份迟早会和真实渲染对不上。
 */
type RowHit =
	| { type: "item"; index: number }
	| { type: "tab"; tab: number; from: number; to: number }
	| { type: "none" };

export interface MenuListOptions {
	items: MenuItem[];
	maxVisible: number;
	/** 多选模式：空格勾选，回车确认。 */
	multi?: boolean;
	/** hotkey：按 / 进入搜索；always：直接输入即搜索；off：禁用搜索。 */
	search?: "hotkey" | "always" | "off";
	/**
	 * 分栏模式：把 item.group 变成顶部可切换的 tab，一次只显示一组。
	 *
	 * 复用 group 而不是新加字段，是因为调用方已经按语义分好组了；
	 * 开关一个布尔值就能在「长列表」和「分栏」之间切，不用改 items。
	 */
	tabs?: boolean;
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
	/** 分栏模式下的 tab 名，按 items 里 group 首次出现的顺序。 */
	private readonly tabs: string[];
	private activeTab = 0;
	/** 上一次 render 的「行号 → 命中目标」，鼠标点击靠它把屏幕坐标翻译回菜单项。 */
	private rowMap: RowHit[] = [];
	/** tab 条上每个 tab 占据的列区间，同样由 render 写入。 */
	private tabHits: { from: number; to: number; tab: number }[] = [];

	constructor(theme: Theme, tui: TUI, keys: KeybindingsManager, opts: MenuListOptions) {
		this.theme = theme;
		this.tui = tui;
		this.keys = keys;
		this.opts = opts;
		this.items = opts.items;
		this.searching = opts.search === "always";
		for (const item of opts.items) {
			if (item.checked) {
				this.checked.add(item.id);
			}
		}
		this.tabs = opts.tabs
			? [...new Set(opts.items.map((i) => i.group).filter((g): g is string => !!g))]
			: [];
		const index = opts.initialId ? opts.items.findIndex((i) => i.id === opts.initialId) : -1;
		// 初始项决定初始 tab，这样「上次停在哪」跨 tab 也能恢复。
		if (this.tabs.length > 0 && index >= 0) {
			const group = opts.items[index]?.group;
			const tabIndex = group ? this.tabs.indexOf(group) : -1;
			if (tabIndex >= 0) {
				this.activeTab = tabIndex;
			}
		}
		this.filtered = this.visibleItems();
		const local = index >= 0 ? this.filtered.indexOf(opts.items[index] as MenuItem) : -1;
		this.selected = local >= 0 ? local : 0;
	}

	/** 当前 tab 下应该显示的项；非分栏模式就是全部。 */
	private visibleItems(): MenuItem[] {
		if (this.tabs.length === 0) {
			return this.items;
		}
		const tab = this.tabs[this.activeTab];
		return this.items.filter((i) => i.group === tab);
	}

	/** 切 tab：光标回到该组第一项。 */
	private switchTab(delta: number): void {
		if (this.tabs.length === 0) {
			return;
		}
		// 搜索态下 tab 无意义（结果跨组），先退出搜索再切。
		this.query = "";
		this.activeTab = (this.activeTab + delta + this.tabs.length) % this.tabs.length;
		this.filtered = this.visibleItems();
		this.selected = 0;
		const item = this.current();
		if (item) {
			this.opts.onHighlight?.(item);
		}
		this.tui.requestRender();
	}

	private goToTab(index: number): void {
		if (index < 0 || index >= this.tabs.length || index === this.activeTab) {
			return;
		}
		this.switchTab(index - this.activeTab);
	}

	invalidate(): void {}

	getChecked(): string[] {
		return this.items.filter((i) => this.checked.has(i.id)).map((i) => i.id);
	}

	private current(): MenuItem | undefined {
		return this.filtered[this.selected];
	}

	/**
	 * 找按键对应的项，并保证它在当前可见集合里。
	 *
	 * 快捷键是跨栏的：分栏之前 `3` 就是主模型，分栏之后它不该因为「你正好停在外观栏」
	 * 而失灵 —— 卡片上明明写着 `3`。命中别的栏就先切过去再选。
	 * 同一个键在两栏里重复时，当前栏优先。
	 */
	private hotkeyTarget(data: string): MenuItem | undefined {
		const inTab = this.filtered.find((i) => i.hotkey === data);
		if (inTab) {
			return inTab;
		}
		if (this.tabs.length === 0 || this.query) {
			return undefined;
		}
		const anywhere = this.items.find((i) => i.hotkey === data);
		if (!anywhere?.group) {
			return undefined;
		}
		this.goToTab(this.tabs.indexOf(anywhere.group));
		return this.filtered.includes(anywhere) ? anywhere : undefined;
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

	/**
	 * 搜索刻意跨 tab：要找「Advisor 阈值」时不该先猜它归在哪一栏。
	 * 清空搜索词后回到当前 tab 的范围。
	 */
	private applyFilter(): void {
		const keepId = this.current()?.id;
		this.filtered = this.query
			? fuzzyFilter(
					this.items,
					this.query,
					(i) => `${i.label} ${i.hint ?? ""} ${i.value ?? ""} ${i.keywords ?? ""}`,
				)
			: this.visibleItems();
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
		// Tab / Shift-Tab 切换分栏；←→ 也接，方向键更符合「分栏」的直觉。
		if (this.tabs.length > 0) {
			if (data === "\t" || data === "\x1b[C") {
				this.switchTab(1);
				return;
			}
			if (data === "\x1b[Z" || data === "\x1b[D") {
				this.switchTab(-1);
				return;
			}
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
			const hit = this.hotkeyTarget(data);
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

	/**
	 * 分栏模式下列表区固定占多少行。
	 *
	 * 取各 tab 里项数最多的那个（再受 maxVisible 限制），不够的用空行补。
	 * 不这么做的话「外观」两项、「工作流」七项，按一下 Tab 整张卡片连底部提示行
	 * 一起上下蹦一截 —— tab 的用途就是快速来回切，切一次跳一次是最刺眼的那种毛病。
	 */
	private stableItemRows(): number {
		if (this.tabs.length === 0 || this.query) {
			return 0;
		}
		const most = this.tabs.reduce(
			(max, tab) => Math.max(max, this.items.filter((i) => i.group === tab).length),
			0,
		);
		return Math.min(this.opts.maxVisible, most);
	}

	private buildDisplay(): DisplayRow[] {
		const rows: DisplayRow[] = [];
		// 分栏模式下 tab 标题已经表达了分组，再画一遍组名是重复的；
		// 但搜索结果跨 tab，这时组名是唯一的定位线索，要留着。
		const showGroups = this.tabs.length === 0 || !!this.query;
		let group: string | undefined;
		this.filtered.forEach((item, index) => {
			if (showGroups && item.group && item.group !== group) {
				if (rows.length > 0) {
					rows.push({ type: "blank" });
				}
				rows.push({ type: "group", text: item.group });
			}
			group = item.group;
			rows.push({ type: "item", item, index });
		});
		return rows;
	}

	/**
	 * Tab 条：`外观 · 模型 · 工作流`，当前项反色。
	 * 分隔符用 `·` 而不是 `│` —— 卡片全篇不画框线，一根竖线会读成「这里有个边框」。
	 * 每个 tab 的列区间记进 rowMap，供鼠标点击命中。
	 */
	private renderTabs(inner: number): { line: string; hits: { from: number; to: number; tab: number }[] } {
		const theme = this.theme;
		const hits: { from: number; to: number; tab: number }[] = [];
		// 从第 0 列起：卡片自己会缩进 2 列，这里再缩就比标题和菜单光标多出两列，
		// tab 条会看起来往右掉了一截。
		let out = "";
		let col = 0;
		this.tabs.forEach((name, i) => {
			if (i > 0) {
				out += sep(this.theme, false);
				col += 3;
			}
			const active = i === this.activeTab && !this.query;
			const text = ` ${name} `;
			out += active
				? theme.bg("selectedBg", theme.bold(theme.fg("text", text)))
				: theme.fg("muted", text);
			hits.push({ from: col, to: col + visibleWidth(text), tab: i });
			col += visibleWidth(text);
		});
		const right = this.query ? theme.fg("dim", "搜索中（跨栏）") : "";
		return { line: right ? splitRow(out, right, inner) : padTo(out, inner), hits };
	}

	/** 分组标题：不画横线，只用一行暗色小字带出层级。 */
	private renderGroup(text: string): string {
		return `  ${this.theme.fg("dim", text)}`;
	}

	/** 选中项的说明文字，缩进对齐到标签列。空说明也返回一行，好让高度不变。 */
	private renderHint(text: string, indent: number): string {
		return text ? `${" ".repeat(indent)}${this.theme.fg("muted", text)}` : "";
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
			? // 未选中的直达键早先用 borderMuted，在深色终端上大约 2.2:1，
				// 等于把「按哪个键」这条信息藏起来了。dim 约 3.7:1，仍然次要但认得出。
				`${theme.fg(selected ? "accent" : "dim", padTo(item.hotkey ?? "", cols.hotkey - 1))} `
			: "";
		const check = cols.check
			? this.checked.has(item.id)
				? theme.fg("success", "[✓] ")
				// 空勾选框早先用 borderMuted，等于看不见 —— 多选菜单里「哪些没勾」
				// 和「哪些勾了」一样是信息。
				: theme.fg(selected ? "text" : "dim", "[ ] ")
			: "";
		const tone = onSelectedBg(item.tone ?? (selected ? "accent" : "text"), selected);
		const labelText = padTo(labelOf(item), cols.label);
		const label = selected
			? theme.bold(theme.fg(tone, labelText))
			: theme.fg(tone, labelText);
		const value =
			cols.value > 0
				? `  ${theme.fg(selected ? "text" : "dim", padStartTo(item.value ?? "", cols.value))}`
				: "";
		const row = `${cursor}${hotkey}${check}${label}${value}`;
		if (!selected) {
			return row;
		}
		// 只给内容块铺底色，不铺满整行。卡片有 96 列而菜单内容常常只占一半，
		// 铺满会在右边拖出一条几十列宽的纯色块，比它要强调的文字还抢眼。
		// `trail` 正是 menuColumns 留在行尾的空白宽度，多留 1 列免得数值贴着边。
		return theme.bg("selectedBg", padTo(row, Math.min(inner, inner - cols.trail + 1)));
	}

	render(inner: number): string[] {
		const theme = this.theme;
		const lines: string[] = [];
		// rowMap 与 lines 一一对应，push 顺序必须完全同步。
		const map: RowHit[] = [];
		const push = (line: string, hit: RowHit = { type: "none" }) => {
			lines.push(line);
			map.push(hit);
		};
		if (this.searching || this.query) {
			push(
				splitRow(
					`${theme.fg("dim", "搜索")} ${theme.fg("text", this.query)}${theme.fg("accent", "▏")}`,
					theme.fg("dim", `${this.filtered.length}/${this.items.length}`),
					inner,
				),
			);
		}
		if (this.tabs.length > 0) {
			const { line, hits } = this.renderTabs(inner);
			// 一行里有多个 tab，用第一个占位，命中时再按列号细分。
			push(line, { type: "tab", tab: -1, from: 0, to: 0 });
			this.tabHits = hits;
		}
		push("");
		if (this.filtered.length === 0) {
			push(`  ${theme.fg("warning", this.opts.emptyText ?? "没有匹配项")}`);
			push("");
			this.rowMap = map;
			return lines;
		}
		// 分栏且未搜索时按全部项算列宽，而不是只按当前 tab 的项。
		// 只按当前 tab 算的话，每切一次 tab 标签列和数值列都重新收缩一次，
		// 文字会左右横跳；宽终端下本来就有余量，统一列宽的代价只是行尾少几列留白。
		const forColumns = this.tabs.length > 0 && !this.query ? this.items : this.filtered;
		const cols = menuColumns(forColumns, inner, this.opts.multi ?? false);
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
				push("");
			} else if (row.type === "group") {
				push(this.renderGroup(row.text));
			} else {
				push(this.renderItem(row.item, row.index === this.selected, cols, inner), {
					type: "item",
					index: row.index,
				});
			}
		}
		for (let i = end - start; i < this.stableItemRows(); i++) {
			push("");
		}
		if (display.length > max) {
			push(
				splitRow(
					// 箭头是「还有更多」的唯一提示，用 dim 而不是 borderMuted，后者看不见。
					theme.fg("dim", `  ${start > 0 ? "▲" : " "}${end < display.length ? "▼" : " "}`),
					theme.fg("dim", `${this.selected + 1}/${this.filtered.length}`),
					inner,
				),
			);
		} else if (this.stableItemRows() > 0) {
			// 有的 tab 需要翻页行、有的不需要，这一行也得占住，否则高度还是会差一行。
			push("");
		}
		// 说明文字固定占最后一行，不插在选中行下面。插在列表里的话，光标每移动一格，
		// 说明行就跟着换位置，它下面的所有行都要错开一行 —— 看起来像整个列表在抖。
		// 代价是没有说明时也占着这一行，否则高度又会变。
		push("");
		push(this.renderHint(this.current()?.hint ?? "", indent));
		this.rowMap = map;
		return lines;
	}

	/**
	 * 鼠标命中：row 是相对本组件第一行的行号，col 是相对卡片内容区的列号。
	 * 返回 true 表示这次点击被消费掉了。
	 */
	clickAt(row: number, col: number): boolean {
		const hit = this.rowMap[row];
		if (!hit) {
			return false;
		}
		if (hit.type === "tab") {
			const target = this.tabHits.find((h) => col >= h.from && col < h.to);
			if (target) {
				this.goToTab(target.tab);
				return true;
			}
			return false;
		}
		if (hit.type === "item") {
			const already = hit.index === this.selected;
			this.moveTo(hit.index);
			// 第一次点击只移动光标（等于「看一眼」），点已选中的行才算确认。
			// 避免误触直接进到子菜单里去。
			if (already) {
				const item = this.current();
				if (item) {
					if (this.opts.multi) {
						this.toggle();
					} else {
						this.opts.onSelect(item);
					}
				}
			}
			return true;
		}
		return false;
	}

	/** 滚轮：上下移动光标。 */
	scrollBy(delta: number): void {
		this.move(delta);
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
	/** 把 item.group 变成顶部 tab，一次只显示一组。 */
	tabs?: boolean;
	initialId?: string;
	emptyText?: string;
	maxWidth?: number;
	/** 给对话区预留的行数，越大则菜单越矮。 */
	reserved?: number;
	/** 光标移动回调，用于实时预览。 */
	onHighlight?(id: string): void;
	/**
	 * 鼠标点击 / 滚轮支持。
	 *
	 * 打开后菜单改用 overlay 渲染，因为点击映射需要知道组件的绝对屏幕位置，
	 * 而内联渲染做不到：pi 把所有组件摊平成一个行数组再按 viewportTop 截取，
	 * 扩展拿不到那个偏移，且 editorContainer 下面还有 footer（高度可变）。
	 * overlay 可以指定 row/col，几何关系是确定的。
	 *
	 * 代价是卡片不再像一条普通消息那样贴在对话流里，而是一个定位的浮层。
	 * 所以这里按菜单逐个开，不做全局默认。
	 */
	mouse?: boolean;
}

function defaultHints(spec: MenuSpec, multi: boolean): KeyHint[] {
	const hints: KeyHint[] = [{ key: "↑↓", label: "移动" }];
	if (spec.tabs) {
		hints.push({ key: "tab/←→", label: "分栏" });
	}
	if (multi) {
		hints.push({ key: "空格", label: "勾选" }, { key: "⏎", label: "保存" });
	} else {
		// 开鼠标时把「点击」并进同一条，不要出现两个「选择」。
		hints.push({ key: spec.mouse ? "⏎/点击" : "⏎", label: "选择" });
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
	fillWidth = false,
): Card {
	return new Card(theme, {
		title: spec.title,
		titleRight: spec.titleRight,
		status: spec.status ? () => spec.status?.(theme) ?? [] : undefined,
		hints: () => spec.hints ?? defaultHints(spec, multi),
		maxWidth: spec.maxWidth,
		fillWidth,
		body,
	});
}

/**
 * overlay 的左上角坐标：鼠标坐标减掉它就是卡片内坐标。
 *
 * col 必须是 0 且卡片开 fillWidth —— 否则 overlay 只覆盖中间那一条，
 * 两侧漏出底下的对话文字，看起来就是一片乱码。
 */
// 导出是给测试用的：测试里手写偏移量会和这里悄悄对不上。
export const OVERLAY_ROW = 1;
export const OVERLAY_COL = 0;

/** 单选菜单：返回选中项 id，Esc 返回 undefined。 */
export function runMenu(host: UiHost, spec: MenuSpec): Promise<string | undefined> {
	const useMouse = spec.mouse ?? false;
	return host.ui.custom<string | undefined>(
		(tui, theme, keybindings, done) => {
			const menu = new MenuList(theme, tui, keybindings, {
				items: spec.items,
				maxVisible: visibleRows(tui, spec.reserved),
				search: spec.search ?? "hotkey",
				tabs: spec.tabs,
				initialId: spec.initialId,
				emptyText: spec.emptyText,
				onSelect: (item) => done(item.id),
				onCancel: () => done(undefined),
				onHighlight: spec.onHighlight ? (item) => spec.onHighlight?.(item.id) : undefined,
			});
			const card = cardFor(theme, spec, menu, false, useMouse);
			if (!useMouse) {
				return card;
			}
			return attachMouse(card, tui);
		},
		useMouse
			? {
					overlay: true,
					overlayOptions: () => ({
						row: OVERLAY_ROW,
						col: OVERLAY_COL,
						// 铺满整个终端宽度，卡片内容仍按 MAX_CARD_WIDTH 排版。
						width: tuiColumns(),
						// 超出终端高度的行会被 compositeOverlays 静默丢掉（含底部提示行）。
						maxHeight: Math.max(6, tuiRows() - OVERLAY_ROW - 1),
					}),
				}
			: undefined,
	);
}

/** 当前终端列数；取不到时给个保守值。 */
function tuiColumns(): number {
	return process.stdout.columns ?? 80;
}

/** 当前终端行数；取不到时给个保守值。 */
function tuiRows(): number {
	return process.stdout.rows ?? 24;
}

/**
 * 给卡片挂上鼠标：进入时开启 SGR 跟踪，dispose 时务必关掉。
 *
 * 监听器装在 tui 上而不是靠 handleInput —— 鼠标序列不属于按键流，
 * 走 handleInput 会和搜索框的可打印字符判定打架（`\x1b[<0;20;5M` 里都是可打印字符）。
 */
function attachMouse(
	card: Card,
	tui: TUI,
): Card & { dispose(): void } {
	tui.terminal.write(MOUSE_ON);
	// 兜底：进程被信号打断时 pi 不会走 dispose，鼠标跟踪就留在开着的状态，
	// 用户只能重启终端。exit 处理器必须是同步的（process.on("exit") 不等异步）。
	const onExit = () => {
		try {
			tui.terminal.write(MOUSE_OFF);
		} catch {
			// 进程正在退出，写不出去也没别的办法了。
		}
	};
	process.once("exit", onExit);
	const removeListener = tui.addInputListener((data) => {
		const ev = parseMouse(data);
		if (!ev) {
			// 不是鼠标序列就原样放行，交给正常的按键处理。
			return undefined;
		}
		if (ev.type === "wheel") {
			card.scrollBy(ev.delta);
			tui.requestRender();
			return { consume: true };
		}
		// 只在松开时动作：按下就触发会让「按住拖出去再松手」也算点击。
		if (ev.type === "release" && ev.button === 0) {
			if (card.clickAt(ev.row - OVERLAY_ROW, ev.col - OVERLAY_COL)) {
				tui.requestRender();
			}
		}
		// 按下 / 其他键的事件一律吞掉，别让 ESC[ 序列漏进搜索框。
		return { consume: true };
	});
	const wrapped = card as Card & { dispose(): void };
	wrapped.dispose = () => {
		removeListener();
		process.removeListener("exit", onExit);
		// 必须关掉。否则控制台关了以后终端继续上报鼠标，stdin 里全是乱码。
		tui.terminal.write(MOUSE_OFF);
	};
	return wrapped;
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
