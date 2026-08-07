/**
 * 子代理的工具权限：默认只读是否真的落到子进程，以及 plan 模式的写权限关卡。
 *
 * 这两件事都属于"错了不会报错、只会静默放行"的类别 —— 子进程照样跑完、照样返回结果，
 * 只是它手上多了 edit/write。所以这里断言的是传给子进程的 argv 本身。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyBase } from "../extensions/pi-extends/config.ts";
import { buildChildArgs, roleWriteTools } from "../extensions/pi-extends/subagents.ts";

/** 取 --tools 后面那个值；没传 --tools 返回 undefined。 */
function toolsOf(args: string[]): string | undefined {
	const i = args.indexOf("--tools");
	return i < 0 ? undefined : args[i + 1];
}

test("roles 未配置时，只读角色的 --tools 依然会传给子进程", () => {
	// emptyBase() 是真实加载链的起点：roles 是 {}。没有 pi-extends.json 的机器就是这个状态。
	const config = emptyBase();
	for (const role of ["scout", "planner", "reviewer"] as const) {
		const tools = toolsOf(buildChildArgs(config, role, "查一下", null));
		assert.equal(tools, "read,grep,find,ls", `${role} 应拿到只读工具集`);
	}
});

test("worker 未配置时拿到的是带写权限的默认集", () => {
	assert.equal(toolsOf(buildChildArgs(emptyBase(), "worker", "改一下", null)), "read,bash,edit,write");
});

test("用户显式配置的工具集优先于默认集", () => {
	const config = emptyBase();
	config.roles.scout = { tools: ["read"] };
	assert.equal(toolsOf(buildChildArgs(config, "scout", "查一下", null)), "read");
});

test("plan 模式关卡：只读角色在默认配置下没有写权限", () => {
	const config = emptyBase();
	for (const role of ["scout", "planner", "reviewer"] as const) {
		assert.deepEqual(roleWriteTools(config, role), [], `${role} 不该被判定为有写权限`);
	}
});

test("plan 模式关卡：worker 的写权限工具被逐个列出", () => {
	// bash 也在内：父进程的 isSafeCommand 允许清单是 tool_call 钩子，管不到子进程。
	assert.deepEqual(roleWriteTools(emptyBase(), "worker"), ["bash", "edit", "write"]);
});

test("plan 模式关卡按工具判定，不按角色名 —— 配了 edit 的 scout 也会被拦", () => {
	const config = emptyBase();
	config.roles.scout = { tools: ["read", "edit"] };
	assert.deepEqual(roleWriteTools(config, "scout"), ["edit"]);
});

test("plan 模式关卡按工具判定 —— 改成只读的 worker 不再被拦", () => {
	const config = emptyBase();
	config.roles.worker = { tools: ["read", "grep"] };
	assert.deepEqual(roleWriteTools(config, "worker"), []);
});

test("未知角色不当成有写权限（由 runSingleRole 负责报错）", () => {
	assert.deepEqual(roleWriteTools(emptyBase(), "nope"), []);
});
