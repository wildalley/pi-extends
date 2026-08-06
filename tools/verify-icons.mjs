/**
 * 核对 icons.ts 的字形表。改动图标表后必须跑一遍。
 *
 *   curl -sL -o /tmp/lucide-info.json https://unpkg.com/lucide-static@latest/font/info.json
 *   curl -sL -o /tmp/nf.json https://raw.githubusercontent.com/ryanoasis/nerd-fonts/master/glyphnames.json
 *   node --experimental-strip-types tools/verify-icons.mjs
 *
 * 检查四件事：
 *   1. lucide 列的码位 == 该行 `lucide:` 字段所写图标名在官方字体里的码位
 *   2. nerd 列的码位在 Nerd Fonts 官方字形表里真实存在
 *   3. 四列每个字形都是单码位、1 列宽（visibleWidth，渲染时用的就是它）
 *   4. 不含 emoji 平面码位与变体选择符
 *
 * 前两条本机是测不出来的 —— 码位写错只会让装了对应字体的人看到豆腐块，
 * 没装的人和 CI 都一切正常。所以必须比对上游表，不能靠肉眼或印象。
 */
import { readFileSync } from "node:fs";
import { visibleWidth } from "@earendil-works/pi-tui";
import { GLYPH_TABLE } from "../extensions/pi-extends/icons.ts";

const lucideInfo = JSON.parse(readFileSync("/tmp/lucide-info.json", "utf8"));
const nf = JSON.parse(readFileSync("/tmp/nf.json", "utf8"));

/** Nerd Fonts 码位 → 字形名，用于反查「这个码位到底是什么图标」。 */
const nerdByCode = new Map();
for (const [name, v] of Object.entries(nf)) {
	if (name === "METADATA" || !v?.code) continue;
	const cp = parseInt(v.code, 16);
	if (!nerdByCode.has(cp)) nerdByCode.set(cp, []);
	nerdByCode.get(cp).push(name);
}

const hex = (s) => [...s].map((c) => c.codePointAt(0).toString(16)).join("+");
const problems = [];
const rows = Object.entries(GLYPH_TABLE);

for (const [name, entry] of rows) {
	const { glyphs, lucide: lucideName, nerd: nerdName } = entry;
	const [lucide, nerd] = glyphs;

	const want = lucideInfo[lucideName]?.encodedCode?.replace("\\", "");
	if (!want) {
		problems.push(`${name}: lucide 图标名 "${lucideName}" 不在官方字体里`);
	} else if (hex(lucide) !== want) {
		problems.push(`${name}: lucide 应为 ${want}（${lucideName}），实际 ${hex(lucide)}`);
	}

	const nerdNames = nerdByCode.get(nerd.codePointAt(0));
	if (!nerdNames) {
		problems.push(`${name}: nerd 码位 U+${hex(nerd)}（${nerdName}）不在 Nerd Fonts 字形表里`);
	}

	glyphs.forEach((g, i) => {
		const label = ["lucide", "nerd", "unicode", "ascii"][i];
		const cps = [...g];
		if (cps.length !== 1) {
			problems.push(`${name}.${label}: 应为单个码位，实际 ${cps.length} 个（${hex(g)}）`);
			return;
		}
		const cp = cps[0].codePointAt(0);
		if (cp === 0xfe0f || cp === 0xfe0e) {
			problems.push(`${name}.${label}: 含变体选择符，字体会切成 emoji 呈现`);
		}
		if (cp >= 0x1f000 && cp <= 0x1faff) {
			problems.push(`${name}.${label}: 落在 emoji 平面（U+${hex(g)}）`);
		}
		const w = visibleWidth(g);
		if (w !== 1) {
			problems.push(`${name}.${label}: 宽度 ${w} 列，必须是 1（U+${hex(g)}）`);
		}
	});

	if (glyphs[3].codePointAt(0) > 0x7e) {
		problems.push(`${name}.ascii: "${glyphs[3]}" 不是 ASCII`);
	}
}

console.log(`核对 ${rows.length} 个图标 × 4 套字形 = ${rows.length * 4} 个字形`);
if (problems.length > 0) {
	console.error(`\n${problems.length} 个问题：`);
	for (const p of problems) console.error(`  ${p}`);
	process.exit(1);
}
console.log("lucide 码位、nerd 码位、宽度、emoji 检查全部通过");
