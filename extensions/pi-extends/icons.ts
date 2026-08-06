/**
 * 语义图标表：一个名字，四套字形。
 *
 * 界面里不写死任何字符，只写「这里是什么」（`icon("model")`），字形由当前图标集决定。
 * 换一套图标不用翻遍每个菜单，也不会出现同一个概念在两个页面长得不一样。
 *
 * 四套字形按「好看 → 一定能显示」排：
 *   - `lucide`：Lucide 官方字体（lucide-static 的 lucide.ttf），码位在私有区。
 *     终端画不了 SVG，得把这个 ttf 加进终端的 fallback 字体链才有字形，装法见 README。
 *   - `nerd`：Nerd Font 补丁字体（Font Awesome / Powerline / Codicons 段）。
 *     开发机上的等宽字体多半已经打过这个补丁。
 *   - `unicode`：几何图形与 Block Elements，任何字体都有，是安全兜底。
 *   - `ascii`：纯 ASCII，给 SSH 进老终端、日志重定向这类场合。
 *
 * ## 为什么码位写成 `\uXXXX` 而不是直接贴字符
 *
 * 私有区字符在编辑器、剪贴板、diff 工具里都显示成豆腐块，肉眼无法校对，
 * 复制粘贴过程中丢字符也不会有任何报错 —— 本文件就曾经这么丢过四个。
 * 写成转义序列后源码全是 ASCII，码位可读、diff 可审、传输不会损坏。
 *
 * ## 约束
 *
 * 全表不含任何表情符号：没有 U+1F000 以上的码位，也没有 U+FE0F 变体选择符
 * （加了它字体会切成彩色 emoji 呈现，宽度还会从 1 列变 2 列，整列对齐就散了）。
 * 每个字形都必须是单码位、1 列宽。
 *
 * `tests/icons.test.ts` 把这些约束写成了断言；`tools/verify-icons.mjs` 再拿
 * Lucide 与 Nerd Fonts 的官方码位表核对一遍 —— 码位写错只会让装了对应字体的人
 * 看到豆腐块，没装的人和 CI 都一切正常，所以必须比对上游，不能靠印象。
 */

/** 可选图标集，顺序与每行 `glyphs` 元组的顺序一致。 */
export const ICON_SETS = ["lucide", "nerd", "unicode", "ascii"] as const;
export type IconSet = (typeof ICON_SETS)[number];

interface GlyphEntry {
	/** 四套字形，顺序同 ICON_SETS。 */
	glyphs: readonly [lucide: string, nerd: string, unicode: string, ascii: string];
	/** 上游图标名，供 verify-icons 反查码位是否对得上，也便于回查改名。 */
	lucide: string;
	nerd: string;
}

const g = (
	lucide: string,
	nerd: string,
	unicode: string,
	ascii: string,
	names: { lucide: string; nerd: string },
): GlyphEntry => ({ glyphs: [lucide, nerd, unicode, ascii], ...names });

/**
 * 全表。一行四套字形并排，是为了让「同一个概念在四套里长得一样」这件事
 * 能一眼看出来 —— 换字形最容易犯的错就是四套之间语义漂移。
 */
export const GLYPH_TABLE = {
	// —— 控制台条目 ——
	theme: g("\ue1dd", "\uf1fc", "◐", "~", { lucide: "palette", nerd: "fa-paint_brush" }),
	footer: g("\ue42c", "\uf0c9", "▤", "=", { lucide: "panel-bottom", nerd: "fa-bars" }),
	model: g("\ue3c6", "\uf2db", "◆", "@", { lucide: "brain", nerd: "fa-microchip" }),
	roles: g("\ue1a4", "\uf0c0", "◇", "&", { lucide: "users", nerd: "fa-users" }),
	routes: g("\ue53e", "\uf0e8", "◈", ">", { lucide: "route", nerd: "fa-sitemap" }),
	plans: g("\ue0aa", "\uf09d", "◉", "$", { lucide: "credit-card", nerd: "fa-credit_card" }),
	providers: g("\ue37f", "\uf1e6", "⊕", "%", { lucide: "plug", nerd: "fa-plug" }),
	subagents: g("\ue425", "\uf1b3", "▸", "#", { lucide: "workflow", nerd: "fa-cubes" }),
	goal: g("\ue180", "\uf140", "⊙", "!", { lucide: "target", nerd: "fa-bullseye" }),
	planMode: g("\ue1d0", "\uf0ae", "▦", ":", { lucide: "list-checks", nerd: "fa-tasks" }),
	prompts: g("\ue0cc", "\uf15c", "◦", '"', { lucide: "file-text", nerd: "fa-file_text" }),
	advisor: g("\ue1ff", "\uf132", "▲", "?", { lucide: "shield-check", nerd: "fa-shield" }),
	keywords: g("\ue412", "\uf0d0", "✦", "*", { lucide: "sparkles", nerd: "fa-magic" }),
	orchestration: g("\ue125", "\uf1e0", "▨", "+", { lucide: "network", nerd: "fa-share_alt" }),
	status: g("\ue038", "\uf0e4", "▣", "=", { lucide: "activity", nerd: "fa-dashboard" }),
	config: g("\ue316", "\uf1de", "○", ".", { lucide: "file-cog", nerd: "fa-sliders" }),
	settings: g("\ue154", "\uf013", "◎", ",", { lucide: "settings", nerd: "fa-cog" }),

	// —— footer 段落 ——
	dir: g("\ue0d7", "\uf07b", "▥", "/", { lucide: "folder", nerd: "fa-folder" }),
	git: g("\ue0e2", "\ue0a0", "⋔", "^", { lucide: "git-branch", nerd: "pl-branch" }),
	ctx: g("\ue1bf", "\uf0e7", "▮", "|", { lucide: "gauge", nerd: "fa-bolt" }),
	usage: g("\ue2a3", "\uf080", "▩", "%", { lucide: "chart-column", nerd: "fa-bar_chart" }),
	cost: g("\ue47d", "\uf155", "¤", "$", { lucide: "circle-dollar-sign", nerd: "fa-dollar" }),
	duration: g("\ue1e0", "\uf017", "◷", "t", { lucide: "timer", nerd: "fa-clock_o" }),

	// —— 子代理角色 ——
	scout: g("\ue5c5", "\uf1e5", "◇", "s", { lucide: "telescope", nerd: "fa-binoculars" }),
	planner: g("\ue09b", "\uf14e", "◈", "p", { lucide: "compass", nerd: "fa-compass" }),
	worker: g("\ue0ec", "\uf0ad", "◆", "w", { lucide: "hammer", nerd: "fa-wrench" }),
	reviewer: g("\ue536", "\uf06e", "◉", "r", { lucide: "scan-eye", nerd: "fa-eye" }),

	// —— 状态 ——
	check: g("\ue06c", "\uf00c", "✓", "v", { lucide: "check", nerd: "fa-check" }),
	cross: g("\ue1b2", "\uf00d", "✗", "x", { lucide: "x", nerd: "fa-times" }),
	warn: g("\ue193", "\uf071", "▲", "!", { lucide: "triangle-alert", nerd: "fa-warning" }),
	info: g("\ue0f9", "\uf05a", "▹", "i", { lucide: "info", nerd: "fa-info_circle" }),
	pending: g("\ue296", "\uf252", "◔", "~", { lucide: "hourglass", nerd: "fa-hourglass_half" }),
	radioOn: g("\ue345", "\uf192", "◉", "o", { lucide: "circle-dot", nerd: "fa-dot_circle_o" }),
	radioOff: g("\ue076", "\uf10c", "○", ".", { lucide: "circle", nerd: "fa-circle_o" }),
	toggleOn: g("\ue18c", "\uf205", "▰", "1", { lucide: "toggle-right", nerd: "fa-toggle_on" }),
	toggleOff: g("\ue18b", "\uf204", "▱", "0", { lucide: "toggle-left", nerd: "fa-toggle_off" }),
	dot: g("\ue44f", "\uf111", "·", ".", { lucide: "dot", nerd: "fa-circle" }),
	dirty: g("\ue552", "\uf444", "●", "*", { lucide: "git-commit-vertical", nerd: "oct-dot_fill" }),

	// —— 动作 ——
	play: g("\ue13c", "\uf04b", "▸", ">", { lucide: "play", nerd: "fa-play" }),
	pause: g("\ue12e", "\uf04c", "▮", "=", { lucide: "pause", nerd: "fa-pause" }),
	stop: g("\ue167", "\uf04d", "■", "#", { lucide: "square", nerd: "fa-stop" }),
	resume: g("\ue073", "\uf051", "▷", ">", { lucide: "chevrons-right", nerd: "fa-step_forward" }),
	reset: g("\ue148", "\uf021", "↺", "r", { lucide: "rotate-ccw", nerd: "fa-refresh" }),
	add: g("\ue13d", "\uf067", "+", "+", { lucide: "plus", nerd: "fa-plus" }),
	remove: g("\ue11c", "\uf068", "-", "-", { lucide: "minus", nerd: "fa-minus" }),
	clear: g("\ue18e", "\uf1f8", "×", "x", { lucide: "trash-2", nerd: "fa-trash" }),
	view: g("\ue0ba", "\uf06e", "◉", "o", { lucide: "eye", nerd: "fa-eye" }),
	search: g("\ue151", "\uf002", "○", "?", { lucide: "search", nerd: "fa-search" }),
	edit: g("\ue1f9", "\uf040", "▨", "e", { lucide: "pencil", nerd: "fa-pencil" }),
	insert: g("\ue0a2", "\uf061", "▸", ">", { lucide: "corner-down-right", nerd: "fa-arrow_right" }),
	steps: g("\ue408", "\uf0cb", "▤", "l", { lucide: "list-tree", nerd: "fa-list_ol" }),
	key: g("\ue4a3", "\uf084", "◈", "k", { lucide: "key-round", nerd: "fa-key" }),
	terminal: g("\ue20a", "\uf120", "▮", "$", { lucide: "square-terminal", nerd: "fa-terminal" }),
	link: g("\ue0b9", "\uf08e", "⇗", "^", { lucide: "external-link", nerd: "fa-external_link" }),
	up: g("\ue070", "\uf077", "▲", "^", { lucide: "chevron-up", nerd: "fa-chevron_up" }),
	down: g("\ue06d", "\uf078", "▼", "v", { lucide: "chevron-down", nerd: "fa-chevron_down" }),
	right: g("\ue06f", "\uf054", "▸", ">", { lucide: "chevron-right", nerd: "fa-chevron_right" }),
	more: g("\ue0b6", "\uf141", "…", ".", { lucide: "ellipsis", nerd: "fa-ellipsis_h" }),

	// —— 模型参数 ——
	thinking: g("\ue29a", "\uf085", "◈", "t", { lucide: "sliders-horizontal", nerd: "fa-gears" }),
	tools: g("\ue1b1", "\uee1b", "◇", "&", { lucide: "wrench", nerd: "fa-toolbox" }),
	fallback: g("\ue28d", "\uf126", "⑂", "f", { lucide: "git-fork", nerd: "fa-code_fork" }),
	autopilot: g("\ue286", "\ueb44", "⇈", "A", { lucide: "rocket", nerd: "cod-rocket" }),
} as const satisfies Record<string, GlyphEntry>;

export type IconName = keyof typeof GLYPH_TABLE;

/** 全部图标名，供预览页与测试遍历。 */
export const ICON_NAMES = Object.keys(GLYPH_TABLE) as IconName[];

const SET_INDEX: Record<IconSet, 0 | 1 | 2 | 3> = {
	lucide: 0,
	nerd: 1,
	unicode: 2,
	ascii: 3,
};

/**
 * 默认 lucide：这套界面就是照 Lucide 设计的。
 *
 * 字体没装时会看到豆腐块，所以控制台的「图标集」一项把四套并排画出来 ——
 * 哪套有字形一眼看得见，选哪套就是了。急着救场也可以 `PI_EXTENDS_ICONS=unicode`，
 * 环境变量优先于配置文件。
 */
export const DEFAULT_ICON_SET: IconSet = "lucide";

/** 把任意字符串解析成图标集名，认不出返回 undefined。 */
export function resolveIconSet(raw: unknown): IconSet | undefined {
	if (typeof raw !== "string") {
		return undefined;
	}
	const v = raw.trim().toLowerCase();
	return (ICON_SETS as readonly string[]).includes(v) ? (v as IconSet) : undefined;
}

/** 环境变量是硬覆盖：设了它，配置文件里的值就不再生效。 */
const forced = resolveIconSet(process.env.PI_EXTENDS_ICONS);
let active: IconSet = forced ?? DEFAULT_ICON_SET;

export function getIconSet(): IconSet {
	return active;
}

/** 切换图标集。返回值表示是否真的切了（被环境变量锁定时不切）。 */
export function setIconSet(set: IconSet): boolean {
	if (forced) {
		return false;
	}
	active = set;
	return true;
}

/** 环境变量是否锁定了图标集 —— 控制台要据此提示「改配置不生效」。 */
export function iconSetForcedByEnv(): IconSet | undefined {
	return forced;
}

/** 取当前图标集下的字形。全表每个字形都是 1 列宽，可直接参与列宽计算。 */
export function icon(name: IconName): string {
	return GLYPH_TABLE[name].glyphs[SET_INDEX[active]];
}

/** 取指定图标集下的字形，用于四套并排预览。 */
export function iconIn(set: IconSet, name: IconName): string {
	return GLYPH_TABLE[name].glyphs[SET_INDEX[set]];
}

/** 一套图标的样例串，用于预览行。 */
export function iconSample(set: IconSet, names: readonly IconName[]): string {
	return names.map((n) => iconIn(set, n)).join(" ");
}
