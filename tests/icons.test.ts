import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	GLYPH_TABLE,
	ICON_NAMES,
	ICON_SETS,
	getIconSet,
	icon,
	iconIn,
	iconSample,
	resolveIconSet,
	setIconSet,
} from "../extensions/pi-extends/icons.ts";

/**
 * U+FE0F 变体选择符。以码位构造而非字面量 —— 否则本文件会被自己的 emoji 检查扫到。
 */
const VS16 = String.fromCodePoint(0xfe0f);

test("每个字形都是单码位、1 列宽", () => {
	for (const name of ICON_NAMES) {
		for (const [i, set] of ICON_SETS.entries()) {
			const glyph = GLYPH_TABLE[name].glyphs[i];
			assert.equal(
				[...glyph].length,
				1,
				`${name}.${set} 应为单个码位，实际 ${[...glyph].length} 个`,
			);
			// 宽度是整套对齐的地基：菜单的图标列按 1 列排版，
			// 混进一个 2 列字形，那一行往后所有内容都会错开一格。
			assert.equal(visibleWidth(glyph), 1, `${name}.${set} 宽度必须是 1 列`);
		}
	}
});

test("不含表情符号：无 emoji 平面码位，无变体选择符", () => {
	for (const name of ICON_NAMES) {
		for (const [i, set] of ICON_SETS.entries()) {
			const glyph = GLYPH_TABLE[name].glyphs[i];
			const cp = glyph.codePointAt(0) ?? 0;
			assert.ok(cp < 0x1f000 || cp > 0x1faff, `${name}.${set} 落在 emoji 平面 U+${cp.toString(16)}`);
			assert.ok(cp !== 0xfe0f && cp !== 0xfe0e, `${name}.${set} 是变体选择符`);
			// 带上变体选择符还是 1 列，才说明这个字形没有 emoji 呈现形态。
			// 有的话，装了 emoji 字体的终端可能自作主张渲染成彩色，宽度随之变 2。
			assert.equal(
				visibleWidth(glyph + VS16),
				1,
				`${name}.${set} 存在 emoji 呈现形态（加 FE0F 后变 ${visibleWidth(glyph + VS16)} 列）`,
			);
		}
	}
});

test("ascii 兜底层真的是 ASCII", () => {
	for (const name of ICON_NAMES) {
		const glyph = GLYPH_TABLE[name].glyphs[ICON_SETS.indexOf("ascii")];
		const cp = glyph.codePointAt(0) ?? 0;
		assert.ok(cp >= 0x20 && cp <= 0x7e, `${name}.ascii "${glyph}" 不在可打印 ASCII 范围内`);
	}
});

test("lucide 与 nerd 两层都落在私有区", () => {
	const inPua = (cp: number) => (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000;
	for (const name of ICON_NAMES) {
		for (const set of ["lucide", "nerd"] as const) {
			const cp = iconIn(set, name).codePointAt(0) ?? 0;
			assert.ok(inPua(cp), `${name}.${set} U+${cp.toString(16)} 不在私有区`);
		}
	}
});

test("每行都带上游图标名，供 verify-icons 反查码位", () => {
	for (const name of ICON_NAMES) {
		const entry = GLYPH_TABLE[name];
		assert.ok(entry.lucide.length > 0, `${name} 缺 lucide 图标名`);
		assert.ok(entry.nerd.length > 0, `${name} 缺 nerd 图标名`);
		// nerd 名字都带字体段前缀（fa- / cod- / oct- / pl- …），没有前缀多半是写错了
		assert.match(entry.nerd, /^[a-z]{2,4}-/u, `${name} 的 nerd 名 "${entry.nerd}" 不像字形名`);
	}
});

test("resolveIconSet 认得四套名字，也认得大小写与空格", () => {
	for (const set of ICON_SETS) {
		assert.equal(resolveIconSet(set), set);
		assert.equal(resolveIconSet(set.toUpperCase()), set);
		assert.equal(resolveIconSet(`  ${set} `), set);
	}
	for (const bad of ["", "emoji", "lucide2", null, undefined, 42, {}]) {
		assert.equal(resolveIconSet(bad), undefined, `不该认出 ${JSON.stringify(bad)}`);
	}
});

test("setIconSet 切换后 icon() 立刻返回新字形", () => {
	const before = getIconSet();
	try {
		for (const set of ICON_SETS) {
			const changed = setIconSet(set);
			// 环境变量锁定时 setIconSet 返回 false，此时跳过 —— 本地跑测试通常没设。
			if (!changed) {
				return;
			}
			assert.equal(getIconSet(), set);
			assert.equal(icon("model"), iconIn(set, "model"));
		}
	} finally {
		setIconSet(before);
	}
});

test("iconSample 按给定顺序拼字形", () => {
	const names = ["model", "roles", "check"] as const;
	assert.equal(iconSample("ascii", names), "@ & v");
	assert.equal(
		iconSample("unicode", names),
		[iconIn("unicode", "model"), iconIn("unicode", "roles"), iconIn("unicode", "check")].join(" "),
	);
});

test("四套字形之间没有重复到同一个字形上", () => {
	// 同一套里两个不同概念用同一个字形是允许的（比如 scout 与 roles 都是 ◇ 兜底），
	// 但同一个图标名在四套里必须各不相同，否则说明某一列没填、直接抄了邻列。
	for (const name of ICON_NAMES) {
		const [lucide, nerd] = GLYPH_TABLE[name].glyphs;
		assert.notEqual(lucide, nerd, `${name} 的 lucide 与 nerd 字形相同，某一列可能没填`);
	}
});

test("源码里不出现表情符号", () => {
	// 这条是界面约束，不是风格偏好：emoji 占 2 列，会顶歪按 1 列排版的图标列；
	// 而且一旦有人图省事直接贴一个，四套字形的切换在那一处就失效了。
	const offenders: string[] = [];
	for (const dir of ["extensions/pi-extends", "tools", "tests"]) {
		for (const file of readdirSync(dir)) {
			if (!/\.(ts|mjs)$/u.test(file)) {
				continue;
			}
			const path = `${dir}/${file}`;
			const src = readFileSync(path, "utf8");
			src.split("\n").forEach((line, i) => {
				for (const ch of line) {
					const cp = ch.codePointAt(0) ?? 0;
					if (cp < 0x80) {
						continue;
					}
					// 判据用实测宽度：2 列即 emoji。按码位段猜会把 ✓ ✗ ✦ 这类
					// 纯文本符号也算进去，而它们正是图标表的 unicode 兜底层。
					if (visibleWidth(ch) === 2 && !isCjk(cp)) {
						offenders.push(`${path}:${i + 1} U+${cp.toString(16)}`);
					}
				}
			});
		}
	}
	assert.deepEqual(offenders, [], `发现表情符号：\n${offenders.join("\n")}`);
});

/** 中日韩字符本身就是 2 列，是正常正文，不算表情符号。 */
function isCjk(cp: number): boolean {
	return (
		(cp >= 0x3000 && cp <= 0x9fff) ||
		(cp >= 0xff00 && cp <= 0xffef) ||
		(cp >= 0x2e80 && cp <= 0x2eff) ||
		(cp >= 0x20000 && cp <= 0x2fa1f)
	);
}
