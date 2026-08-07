/**
 * 事件驱动扩展的测试脚手架。
 *
 * plan-mode / goal-mode 的行为全在 `pi.on(...)` 的回调里，状态藏在模块作用域，
 * 没有可以直接调用的纯函数。这个假 pi 把注册进来的命令/事件/工具收在 Map 里，
 * 由测试主动 emit，于是「enable 之后工具集变成什么」这种断言可以直接对着
 * `h.activeTools` 写。
 *
 * 只实现被测模块真正用到的那部分 ExtensionAPI/ExtensionContext。补全整个接口的
 * 成本远大于收益，缺哪个方法运行时会立刻抛出来。
 *
 * 两处刻意与真实实现对齐，否则测出来的东西不作数：
 * - `appendEntry` 深拷贝 data：真实实现要序列化成 JSONL，持久化的是快照。
 *   直接存引用的话，后续改 todoItems 会把"已落盘"的状态也一起改掉。
 * - `sendMessage` 同时往 entries 里补一条 custom_message：pi 在非 streaming 时
 *   就是这么落盘的，plan-mode 恢复时要靠这条 entry 找执行起点。
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export interface SentMessage {
	customType?: string;
	content?: string;
	display?: boolean;
	triggerTurn?: boolean;
	deliverAs?: string;
}

export interface Note {
	text: string;
	level?: string;
}

/** 事件载荷与 entry 的形状由各扩展自己定，脚手架不做约束。 */
type AnyEvent = any;

export interface Harness {
	pi: ExtensionAPI;
	ctx: ExtensionCommandContext;
	/** 当前工具集，setActiveTools 会整体替换。 */
	activeTools: string[];
	/** 当前分支的 session entries（getBranch 返回这份）。 */
	entries: AnyEvent[];
	/** 只出现在 getEntries() 里的"别的分支"，用来验证恢复逻辑走的是 getBranch。 */
	stray: AnyEvent[];
	/**
	 * sessionManager 上被调用过的方法名，按调用顺序。
	 *
	 * 光靠 stray 只能验证"读到的内容对不对"，读对了也可能是碰巧——
	 * 比如某处压根没读 session。这个数组让"走的是哪个方法"本身可断言。
	 */
	sessionCalls: string[];
	messages: SentMessage[];
	userMessages: string[];
	notes: Note[];
	status: Map<string, string | undefined>;
	widgets: Map<string, string[] | undefined>;
	flags: Map<string, boolean | string>;
	tools: Map<string, AnyEvent>;
	/** ctx.ui.select 的回答；undefined 等价于用户按 Esc。 */
	selectAnswer: string | undefined;
	/** ctx.ui.editor 的回答。 */
	editorAnswer: string | undefined;
	hasUI: boolean;
	pendingMessages: boolean;
	cwd: string;
	/** 跑一条注册进来的斜杠命令。 */
	run(command: string, args?: string): Promise<void>;
	/** 触发一个事件，返回所有 handler 的返回值（顺序同注册顺序）。 */
	emit(event: string, payload?: AnyEvent): Promise<AnyEvent[]>;
	/** 往 entries 里追加一条 assistant 消息。 */
	pushAssistant(text: string): void;
	/** 最后一条指定 customType 的 sendMessage。 */
	lastMessage(customType: string): SentMessage | undefined;
	/** 最后一条指定 customType 的 custom entry 的 data。 */
	lastEntry(customType: string): AnyEvent | undefined;
}

const DEFAULT_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"];

export function makeHarness(options?: { tools?: string[]; cwd?: string }): Harness {
	const commands = new Map<string, (args: string, ctx: AnyEvent) => Promise<void>>();
	const events = new Map<string, ((event: AnyEvent, ctx: AnyEvent) => AnyEvent)[]>();

	function append(entry: AnyEvent): void {
		h.entries.push({
			id: `e${h.entries.length + 1}`,
			parentId: h.entries.length === 0 ? null : `e${h.entries.length}`,
			timestamp: new Date().toISOString(),
			...entry,
		});
	}

	const theme = {
		fg: (_token: string, text: string) => text,
		bold: (text: string) => text,
		dim: (text: string) => text,
		strikethrough: (text: string) => text,
	};

	const ui = {
		theme,
		setStatus: (key: string, value?: string) => {
			h.status.set(key, value);
		},
		setWidget: (key: string, lines?: string[]) => {
			h.widgets.set(key, lines);
		},
		notify: (text: string, level?: string) => {
			h.notes.push({ text, level });
		},
		select: async (_title: string, _choices: string[]) => h.selectAnswer,
		editor: async (_title: string, _initial: string) => h.editorAnswer,
	};

	const ctx = {
		ui,
		mode: "tui",
		isProjectTrusted: () => true,
		hasPendingMessages: () => h.pendingMessages,
		get cwd() {
			return h.cwd;
		},
		get hasUI() {
			return h.hasUI;
		},
		sessionManager: {
			getBranch: () => {
				h.sessionCalls.push("getBranch");
				return [...h.entries];
			},
			getEntries: () => {
				h.sessionCalls.push("getEntries");
				return [...h.entries, ...h.stray];
			},
			getCwd: () => h.cwd,
		},
	};

	const pi = {
		registerFlag: (name: string, opts: { default?: boolean | string }) => {
			if (opts.default !== undefined && !h.flags.has(name)) h.flags.set(name, opts.default);
		},
		getFlag: (name: string) => h.flags.get(name),
		registerCommand: (name: string, def: { handler: (args: string, c: AnyEvent) => Promise<void> }) => {
			commands.set(name, def.handler);
		},
		registerShortcut: () => {},
		registerTool: (def: { name: string }) => {
			h.tools.set(def.name, def);
		},
		on: (event: string, handler: (e: AnyEvent, c: AnyEvent) => AnyEvent) => {
			const list = events.get(event) ?? [];
			list.push(handler);
			events.set(event, list);
		},
		getActiveTools: () => [...h.activeTools],
		setActiveTools: (names: string[]) => {
			h.activeTools = [...names];
		},
		appendEntry: (customType: string, data: unknown) => {
			append({ type: "custom", customType, data: structuredClone(data) });
		},
		sendMessage: (message: SentMessage, opts?: { triggerTurn?: boolean; deliverAs?: string }) => {
			h.messages.push({ ...message, ...opts });
			append({
				type: "custom_message",
				customType: message.customType,
				content: message.content,
				display: message.display,
			});
		},
		sendUserMessage: (content: string) => {
			h.userMessages.push(content);
		},
		getThinkingLevel: () => "off",
	};

	const h: Harness = {
		pi: pi as unknown as ExtensionAPI,
		ctx: ctx as unknown as ExtensionCommandContext,
		activeTools: [...(options?.tools ?? DEFAULT_TOOLS)],
		entries: [],
		stray: [],
		sessionCalls: [],
		messages: [],
		userMessages: [],
		notes: [],
		status: new Map(),
		widgets: new Map(),
		flags: new Map(),
		tools: new Map(),
		selectAnswer: undefined,
		editorAnswer: undefined,
		hasUI: true,
		pendingMessages: false,
		cwd: options?.cwd ?? process.cwd(),

		async run(command, args) {
			const handler = commands.get(command);
			if (!handler) throw new Error(`命令 /${command} 没有被注册`);
			await handler(args ?? "", ctx);
		},

		async emit(event, payload) {
			const results: AnyEvent[] = [];
			for (const handler of events.get(event) ?? []) {
				results.push(await handler(payload ?? {}, ctx));
			}
			return results;
		},

		pushAssistant(text) {
			append({ type: "message", message: { role: "assistant", content: [{ type: "text", text }] } });
		},

		lastMessage(customType) {
			return [...h.messages].reverse().find((m) => m.customType === customType);
		},

		lastEntry(customType) {
			const found = [...h.entries].reverse().find((e) => e.type === "custom" && e.customType === customType);
			return found?.data;
		},
	};

	return h;
}
