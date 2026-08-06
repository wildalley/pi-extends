/**
 * 下载 Lucide 与 Nerd Fonts 的官方码位表，供 patch-icon-codepoints 与 verify-icons 查表。
 *
 * 这两张表是「码位不靠手敲」的前提：icons.ts 里只写图标名，码位一律查表得来。
 * 表本身不进仓库 —— 加起来几 MB，且只在改图标表时才用得上，装进 devDependencies
 * 或提交进来都是让每个 clone 的人替我们的临时需要付账。
 *
 * 默认落到 /tmp，机器重启就没了，重新跑一遍即可：
 *   node tools/fetch-icon-tables.mjs [--dir /tmp]
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const SOURCES = [
	{
		file: "lucide-info.json",
		url: "https://unpkg.com/lucide-static@latest/font/info.json",
		what: "Lucide 字体码位表（字段 encodedCode）",
	},
	{
		file: "nf.json",
		url: "https://raw.githubusercontent.com/ryanoasis/nerd-fonts/master/glyphnames.json",
		what: "Nerd Fonts 字形表（字段 code）",
	},
];

const { values } = parseArgs({ options: { dir: { type: "string", default: "/tmp" } } });

for (const { file, url, what } of SOURCES) {
	const res = await fetch(url);
	if (!res.ok) {
		console.error(`${file}: HTTP ${res.status} ${res.statusText} <- ${url}`);
		process.exit(1);
	}
	const text = await res.text();
	// 先解析一遍再落盘：拿到一份 HTML 错误页也会 200，直接写进去只会让
	// 查表脚本在更靠后的地方报一个看不懂的错。
	let count;
	try {
		count = Object.keys(JSON.parse(text)).length;
	} catch {
		console.error(`${file}: 响应不是合法 JSON（拿到 ${text.length} 字节），未写入`);
		process.exit(1);
	}
	writeFileSync(`${values.dir}/${file}`, text);
	console.log(`${values.dir}/${file}  ${count} 条  ${what}`);
}
