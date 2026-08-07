/**
 * 子代理运行态：给 footer 一行「现在有几个子代理在跑」。
 *
 * 为什么单独一个模块而不是塞进 subagents.ts：footer 与 subagent 工具是两条互不认识的
 * 注册链（footer 在 registerFooter 里拿 ctx，工具在 execute 里拿 ctx），共享状态只能走
 * 模块级单例。计数用 ++/-- 而不是「批次快照」——模型一轮里可以发起两次 subagent 调用，
 * 后一次不该把前一次的计数覆盖掉。
 *
 * 这里没有订阅机制：写 footer 走 ctx.ui.setStatus，pi 内部已经跟着一次 requestRender，
 * 再自己发一遍通知只会重复重绘。
 */

import { icon } from "./icons.ts";

/** footer 状态键。设成常量，clear 时不会写错字留下幽灵状态。 */
export const AGENT_STATUS_KEY = "pi-extends:agents";

export interface AgentStatus {
	/** 正在跑的子代理数 */
	running: number;
	/** 本轮已启动的总数（含已结束的） */
	launched: number;
	/** 已成功结束 */
	done: number;
	/** 已失败结束（非零退出、超时、被中止） */
	failed: number;
}

const state: AgentStatus = { running: 0, launched: 0, done: 0, failed: 0 };

export function getAgentStatus(): Readonly<AgentStatus> {
	return { ...state };
}

export function markAgentStart(): void {
	state.running++;
	state.launched++;
}

export function markAgentEnd(ok: boolean): void {
	// 不让 running 掉到负数：start/end 配对由调用方的 try/finally 保证，
	// 但热重载或异常路径下宁可少减一次也不要显示 -1。
	state.running = Math.max(0, state.running - 1);
	if (ok) {
		state.done++;
	} else {
		state.failed++;
	}
}

/** 全部归零。下一轮开始时由 agent_start 调用，避免上一轮的战绩留在 footer 上。 */
export function resetAgentStatus(): void {
	state.running = 0;
	state.launched = 0;
	state.done = 0;
	state.failed = 0;
}

/**
 * footer 里那一段文字。返回 undefined 表示这一段不该出现
 * （没派过子代理时 footer 不该多出一个空槽）。
 */
export function formatAgentStatus(s: Readonly<AgentStatus> = state): string | undefined {
	if (s.launched === 0) {
		return undefined;
	}
	if (s.running > 0) {
		return `${icon("pending")} ${s.running}/${s.launched} 子代理`;
	}
	if (s.failed > 0) {
		return `${icon("cross")} ${s.failed}/${s.launched} 子代理失败`;
	}
	return `${icon("check")} ${s.done} 子代理`;
}
