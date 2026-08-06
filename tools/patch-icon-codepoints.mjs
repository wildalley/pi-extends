/**
 * 按图标名从上游码位表查出码位，写进 icons.ts 的 lucide / nerd 两列。
 *
 * 为什么需要这个脚本：
 *
 * 1. 私有区字符经不起「当字面量写进文件」这道工序 —— 已经丢过两次，且丢了不报错，
 *    只是安静地变成空串。所以源码里存的是 `\uXXXX` 转义序列，由脚本生成。
 * 2. 码位一律从上游表查，绝不手敲。手敲的码位错了本机测不出来 —— 没装字体的人
 *    和 CI 一切正常，只有装了字体的人看到豆腐块。icons.ts 里每行的 lucide/nerd
 *    图标名就是查表用的键，改图标只改名字，码位跟着自动对。
 *
 * 上游表（由 tools/fetch-icon-tables.mjs 下载到 /tmp）：
 *   - lucide：lucide-static 的 font/info.json，字段 encodedCode 形如 "\\e585"
 *   - nerd  ：Nerd Fonts 的 glyphnames.json，字段 code 形如 "f1fc"
 *
 * 用法：node tools/patch-icon-codepoints.mjs [--table-dir /tmp]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: { "table-dir": { type: "string", default: "/tmp" } },
});
const tableDir = values["table-dir"];

const lucideTable = JSON.parse(readFileSync(`${tableDir}/lucide-info.json`, "utf8"));
const nerdTable = JSON.parse(readFileSync(`${tableDir}/nf.json`, "utf8"));

const iconsPath = new URL("../extensions/pi-extends/icons.ts", import.meta.url);
let src = readFileSync(iconsPath, "utf8");

/**
 * 从源码里读出每行的图标名 —— 名字是数据，所以这里不需要另一份清单。
 *
 * unicode / ascii 两列可能用单引号（列里本身是双引号时，如 prompts 的 `'"'`），
 * 所以这两组按两种引号都收；只收双引号会安静漏掉那一行。
 */
const STR = String.raw`(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')`;
const rowRe = new RegExp(
	String.raw`\n\t(\w+): g\(${STR}, ${STR}, (${STR}), (${STR}), \{ lucide: "([^"]+)", nerd: "([^"]+)" \}\)`,
	"gu",
);

const rows = [...src.matchAll(rowRe)];
if (rows.length === 0) {
	console.error("没在 icons.ts 里匹配到任何图标行，检查 rowRe 是否还跟源码格式一致");
	process.exit(1);
}

const esc = (cp) => `\\u${cp.toString(16).padStart(4, "0")}`;

const errors = [];
let patched = 0;

for (const m of rows) {
	const [full, name, uni, ascii, lucideName, nerdName] = m;

	const lucideEntry = lucideTable[lucideName];
	if (!lucideEntry) {
		errors.push(`${name}: lucide 表里没有 "${lucideName}"`);
		continue;
	}
	// encodedCode 形如 "\\e585"
	const lucideCp = Number.parseInt(lucideEntry.encodedCode.replace(/^\\+/u, ""), 16);

	const nerdEntry = nerdTable[nerdName];
	if (!nerdEntry) {
		errors.push(`${name}: nerd 表里没有 "${nerdName}"`);
		continue;
	}
	const nerdCp = Number.parseInt(nerdEntry.code, 16);

	if (!Number.isFinite(lucideCp) || !Number.isFinite(nerdCp)) {
		errors.push(`${name}: 码位解析失败 lucide=${lucideEntry.encodedCode} nerd=${nerdEntry.code}`);
		continue;
	}

	const replacement = `\n\t${name}: g("${esc(lucideCp)}", "${esc(nerdCp)}", ${uni}, ${ascii}, { lucide: "${lucideName}", nerd: "${nerdName}" })`;
	src = src.replace(full, replacement);
	patched += 1;
}

if (errors.length > 0) {
	// 一个名字查不到就整体不写：半套码位比没有码位更难查。
	console.error(`查表失败 ${errors.length} 项，未写入任何改动：`);
	for (const e of errors) {
		console.error(`  ${e}`);
	}
	process.exit(1);
}

writeFileSync(iconsPath, src);
console.log(`已按上游表写入 ${patched} 行码位`);
