import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	Card,
	MenuList,
	BORDER_STYLES,
	badge,
	gauge,
	kv,
	setBorderStyle,
	getBorderStyle,
	resolveBorderStyle,
} from "../extensions/pi-extends/ui-kit.ts";

/** 卡片最大 / 最小宽度，与 ui-kit 内部常量保持一致。 */
const MAX_CARD_WIDTH = 96;
const MIN_CARD_WIDTH = 24;

/** 测试开始前把边框重置为无边框，防止上一条测试的状态泄漏。 */
beforeEach(() => setBorderStyle("none"));

/** 最小主题替身：只保留 Card/MenuList 用到的方法，颜色部分透传。 */
function fakeTheme(): any {
	return {
		fg: (_c: string, t: string) => t,
		bg: (_c: string, t: string) => `\x1b[7m${t}\x1b[27m`,
		bold: (t: string) => t,
		dim: (t: string) => t,
		italic: (t: string) => t,
		underline: (t: string) => t,
		strikethrough: (t: string) => t,
	};
}

function buildCard(): Card {
	const theme = fakeTheme();
	const tui: any = { terminal: { rows: 40, columns: 100 }, requestRender: () => {} };
	const keys: any = { matches: () => false };
	const items = [
		{ id: "theme", group: "外观", icon: "◐", label: "主题", hotkey: "1", value: "pi-carbon", hint: "移动光标即时预览" },
		{ id: "footer", group: "外观", icon: "▤", label: "状态栏 Footer", hotkey: "2", value: "on", hint: "cometix 单行 · TPS on" },
		{ id: "model", group: "模型", icon: "◆", label: "主模型", hotkey: "3", value: "claude-opus-4-20250514", hint: "thinking high" },
		{ id: "roles", group: "模型", icon: "◇", label: "角色模型与权限", hotkey: "4", value: "2/4 已定制", hint: "scout · planner · worker · reviewer" },
		{ id: "status", group: "系统", icon: "▣", label: "状态总览", hotkey: "s", hint: "模型 / 角色 / 厂商 / 上下文一页看全" },
	];
	const menu = new MenuList(theme, tui, keys, {
		items,
		maxVisible: 14,
		onSelect: () => {},
		onCancel: () => {},
	});
	return new Card(theme, {
		title: "Pi Extends 控制台",
		titleRight: "pi-carbon · v1",
		status: () => [
			kv(theme, "◆", "模型", `claude-opus-4  ·  thinking high  ·  ${badge(theme, "已认证")}`),
			kv(theme, "▤", "上下文", `${gauge(theme, 0.42, 12)} 42%  ·  38k / 200k`),
		],
		hints: () => [
			{ key: "↑↓", label: "移动" },
			{ key: "⏎", label: "选择" },
			{ key: "esc", label: "返回" },
		],
		body: menu,
	});
}

test("Card 每一行的显示宽度都等于卡片宽度（三种边框样式都成立）", () => {
	// 外宽必须与边框样式无关：否则切换样式时菜单会跳宽度，看起来像界面在抖。
	for (const style of BORDER_STYLES) {
		setBorderStyle(style);
		const card = buildCard();
		for (const width of [104, 96, 80, 70, 56, 50, 40]) {
			for (const line of card.render(width)) {
				assert.equal(
					visibleWidth(line),
					Math.min(width, MAX_CARD_WIDTH),
					`style=${style} width=${width}: ${line}`,
				);
			}
		}
	}
});

test("border=none 时不画任何边框字符", () => {
	const card = buildCard();
	for (const width of [96, 50]) {
		for (const line of card.render(width)) {
			assert.ok(!/[╭╮╰╯│├┤─┌┐└┘]/.test(line), `width=${width} 出现边框: ${line}`);
		}
	}
	// 标题行的锚是实体条，和选中行的光标条同一个字符 —— 它属于 Block Elements，
	// 不是 box drawing，所以上面那条「不画边框」的断言依然成立。
	assert.ok(card.render(96)[0]?.startsWith("  ▌"));
});

test("border=round/square 画出闭合的外框，标题嵌在上边框里", () => {
	for (const [style, tl, tr, bl, br] of [
		["round", "╭", "╮", "╰", "╯"],
		["square", "┌", "┐", "└", "┘"],
	] as const) {
		setBorderStyle(style);
		const lines = buildCard().render(96);
		const first = lines[0] ?? "";
		const last = lines[lines.length - 1] ?? "";

		// 四个角都在，框是闭合的。
		assert.ok(first.startsWith(`  ${tl}`), `${style} 左上角: ${first}`);
		assert.ok(first.endsWith(tr), `${style} 右上角: ${first}`);
		assert.ok(last.startsWith(`  ${bl}`), `${style} 左下角: ${last}`);
		assert.ok(last.endsWith(br), `${style} 右下角: ${last}`);

		// 标题在上边框那一行，不再单独占一行。
		assert.ok(first.includes("Pi Extends 控制台"), `${style} 标题应嵌在上边框: ${first}`);
		assert.ok(first.includes("pi-carbon · v1"), `${style} 右侧小字也该在上边框`);
		assert.equal(
			lines.filter((l) => l.includes("Pi Extends 控制台")).length,
			1,
			`${style} 标题出现了两次`,
		);

		// 中间每一行都被竖边包住，不能有漏口。
		for (const line of lines.slice(1, -1)) {
			assert.ok(line.startsWith("  │"), `${style} 左竖边缺失: ${line}`);
			assert.ok(line.endsWith("│"), `${style} 右竖边缺失: ${line}`);
		}
	}
});

test("开边框比不开只多两行（上下边框），标题不再单独占行", () => {
	setBorderStyle("none");
	const plain = buildCard().render(96).length;
	setBorderStyle("round");
	const boxed = buildCard().render(96).length;
	// 上下边框 +2、标题行并入上边框 -1，净 +1。
	assert.equal(boxed, plain + 1, `none=${plain} round=${boxed}`);
});

test("窄卡片截断标题而不是抹掉，且不溢出宽度", () => {
	setBorderStyle("round");
	const card = buildCard();
	for (const width of [40, 32, 28, 26, 24, 22]) {
		const lines = card.render(width);
		for (const line of lines) {
			// 卡片有 24 列的下限（Card.render 里的 Math.max），比这更窄不再收缩。
			assert.equal(
				visibleWidth(line),
				Math.max(MIN_CARD_WIDTH, Math.min(width, MAX_CARD_WIDTH)),
				`width=${width}: ${line}`,
			);
		}
		const first = lines[0] ?? "";
		assert.ok(first.startsWith("  ╭"), `width=${width} 上边框还该在: ${first}`);
		assert.ok(first.endsWith("╮"), `width=${width} 右上角还该在: ${first}`);
		// 卡片没了名字比名字断一截更糟：窄到极限也得留下可辨认的开头。
		assert.ok(first.includes("Pi"), `width=${width} 标题被整条抹掉了: ${first}`);
	}
});

test("边框样式解析容忍大小写与空白，未知值不改现状", () => {
	assert.equal(resolveBorderStyle("ROUND"), "round");
	assert.equal(resolveBorderStyle("  square  "), "square");
	assert.equal(resolveBorderStyle("None"), "none");
	assert.equal(resolveBorderStyle("dashed"), undefined);

	setBorderStyle("square");
	assert.equal(setBorderStyle("nope"), false, "未知值应被拒绝");
	assert.equal(getBorderStyle(), "square", "被拒绝后不该改动现状");
	assert.equal(setBorderStyle("ROUND"), true);
	assert.equal(getBorderStyle(), "round", "归一化后应生效");
});

test("Card 的点击坐标随边框偏移，不会整体错一列", () => {
	// 开边框时正文右移一列，clickAt 的列偏移必须跟着走。
	const seen: { row: number; col: number }[] = [];
	const theme = fakeTheme();
	const body: any = {
		render: (w: number) => ["x".repeat(w)],
		invalidate: () => {},
		clickAt: (row: number, col: number) => {
			seen.push({ row, col });
			return true;
		},
	};
	const card = new Card(theme, { title: "T", body });

	// 扫一遍卡片的前若干列，找出「换算到正文第 0 列」的那一列。
	// 不写死偏移量：内衬宽度改了这条测试也该继续成立，写死就变成同义反复。
	const bodyColumnFor = (style: string): number => {
		setBorderStyle(style);
		card.render(96);
		for (let col = 0; col < 12; col++) {
			seen.length = 0;
			card.clickAt(1, col);
			if (seen[0]?.col === 0) {
				return col;
			}
		}
		return -1;
	};

	const plain = bodyColumnFor("none");
	const boxed = bodyColumnFor("round");
	assert.equal(plain, 2, "none 模式正文从 CARD_PAD 开始");
	// 开边框后正文右移：竖边 1 列 + 内衬 2 列。
	assert.equal(boxed, 5, "round 模式正文应右移 3 列（边框 + 内衬）");
	assert.ok(boxed > plain, "开边框后正文必须右移，否则点击判定会偏格");
});

test("MenuList 选中行只铺到内容块末尾，不铺满整行", () => {
	const card = buildCard();
	const lines = card.render(96);
	const selected = lines.find((line) => line.includes("\x1b[7m"));
	assert.ok(selected, "应该有一行带选中背景");
	const inner = selected.slice(selected.indexOf("\x1b[7m") + 4, selected.indexOf("\x1b[27m"));
	const width = visibleWidth(inner);
	// 铺满整行会在右边拖出几十列纯色块，比内容还抢眼；这里只铺到数值列末尾。
	assert.ok(width < MAX_CARD_WIDTH - 2, `选中行铺了 ${width} 列，等于铺满整行`);
	// 但也得真的把内容包住：光标 + 标签 + 数值都在色块里。
	assert.ok(inner.includes("主题") && inner.includes("pi-carbon"), `色块没包住内容: ${inner}`);
	// 整行仍然补齐到卡片宽度（否则选中行会短一截）。
	assert.equal(visibleWidth(selected), MAX_CARD_WIDTH);
	// 只有选中项展示 hint，未选中项的 hint 不出现在任何一行里。
	assert.ok(lines.some((l) => l.includes("移动光标即时预览")));
	assert.ok(!lines.some((l) => l.includes("cometix 单行")));
});

test("说明行位置固定：光标移动不会让下面的行整体错开", () => {
	const card = buildCard();
	const before = card.render(96);
	const menu = (card as unknown as { opts: { body: MenuList } }).opts.body;
	menu.scrollBy(1);
	const after = card.render(96);
	assert.equal(after.length, before.length, "移动光标后卡片高度变了，列表会看起来在抖");
	// 说明文字换成了新选中项的，但仍在同一行号上。
	const row = before.findIndex((l) => l.includes("移动光标即时预览"));
	assert.ok(row > 0, "第一项的说明应当渲染出来");
	assert.ok(after[row]?.includes("cometix 单行"), `说明行应停在第 ${row} 行: ${after[row]}`);
});
