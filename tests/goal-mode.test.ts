/**
 * Goal 模式的状态机。
 *
 * 这里真正需要守住的是 autopilot：它会自己发消息触发下一轮，一旦「该停的时候没停」
 * 就是无限循环烧 token。所以每一条刹车都单独一个用例 —— 轮次上限、plan 模式在等批准、
 * 有待处理消息、用户中止。
 *
 * 状态迁移的合法性同样成对写：合法的那次要真的改状态，非法的那次要留在原地并告警，
 * 只测前者的话「任何状态都能 resume」这种 bug 是测不出来的。
 */

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import planModeExtension from "../extensions/pi-extends/plan-mode.ts";
import { type Harness, makeHarness } from "./helpers/extension-harness.ts";

type GoalModule = typeof import("../extensions/pi-extends/goal-mode.ts");

let instances = 0;

/** goal-mode 的 state 是模块级变量：查询串换掉缓存 key，每个用例拿到全新一份。 */
async function loadGoalMode(h: Harness): Promise<GoalModule> {
	instances += 1;
	const mod = (await import(`../extensions/pi-extends/goal-mode.ts?case=${instances}`)) as GoalModule;
	mod.default(h.pi);
	return mod;
}

/**
 * goal-mode 会 getConfig(ctx.cwd, trusted) 取 maxAutoTurns，而 store 定位用户级配置
 * 时读 HOME。两者都得指到临时目录，否则用例会跟着开发机上的真实配置飘。
 */
async function withGoal(
	fn: (g: { h: Harness; mod: GoalModule }) => Promise<void>,
	options?: { maxAutoTurns?: number },
): Promise<void> {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-extends-goal-"));
	const home = path.join(root, "home");
	const project = path.join(root, "project");
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(path.join(project, ".pi"), { recursive: true });
	if (options?.maxAutoTurns !== undefined) {
		fs.writeFileSync(
			path.join(project, ".pi", "pi-extends.json"),
			JSON.stringify({ version: 1, goal: { maxAutoTurns: options.maxAutoTurns } }),
		);
	}
	const prevHome = process.env.HOME;
	const prevProfile = process.env.USERPROFILE;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	try {
		const h = makeHarness({ cwd: project });
		const mod = await loadGoalMode(h);
		await fn({ h, mod });
	} finally {
		if (prevHome === undefined) delete process.env.HOME;
		else process.env.HOME = prevHome;
		if (prevProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = prevProfile;
		fs.rmSync(root, { recursive: true, force: true });
	}
}

/** 调注册进来的 goal 工具。 */
async function callGoalTool(h: Harness, params: Record<string, unknown>): Promise<string> {
	const tool = h.tools.get("goal");
	assert.ok(tool, "goal 工具应被注册");
	const result = await tool.execute("call-1", params);
	return result.content[0].text as string;
}

const ASSISTANT_ABORTED = { role: "assistant", content: [], stopReason: "aborted" };

test("start --autopilot 进入 active，轮次上限来自配置", async () => {
	await withGoal(
		async ({ h, mod }) => {
			await h.run("goal", "start 修复登录缺陷 --autopilot");

			const state = mod.getGoalState();
			assert.equal(state.text, "修复登录缺陷", "--autopilot 不该留在目标文本里");
			assert.equal(state.status, "active");
			assert.equal(state.strategy, "autopilot");
			assert.equal(state.maxTurns, 3);
			assert.equal(state.turnsUsed, 0);
			assert.equal(h.lastEntry("goal-mode")?.status, "active", "状态要落盘");
		},
		{ maxAutoTurns: 3 },
	);
});

test("不带 --autopilot 是 focused 策略", async () => {
	await withGoal(async ({ h, mod }) => {
		await h.run("goal", "start 修复登录缺陷");
		assert.equal(mod.getGoalState().strategy, "focused");
	});
});

test("空目标文本被拒绝，不留下任何状态", async () => {
	await withGoal(async ({ h, mod }) => {
		await h.run("goal", "start   ");

		assert.equal(mod.getGoalState().status, "inactive");
		assert.equal(h.notes.at(-1)?.level, "warning");
		assert.equal(h.lastEntry("goal-mode"), undefined, "失败的 start 不该落盘");
	});
});

test("active 时注入目标上下文，暂停后不再注入", async () => {
	await withGoal(async ({ h }) => {
		await h.run("goal", "start 修复登录缺陷 --autopilot");
		await h.emit("agent_settled");

		const injected = (await h.emit("before_agent_start"))[0];
		assert.match(injected.message.content, /\[GOAL ACTIVE\]/);
		assert.match(injected.message.content, /修复登录缺陷/);
		assert.match(injected.message.content, /已用轮次: 1\//);
		assert.equal(injected.message.display, false, "这是给模型看的，不该刷屏");

		await h.run("goal", "pause");
		assert.equal((await h.emit("before_agent_start"))[0], undefined);
	});
});

test("autopilot 每轮结束自动推进，并把目标与轮次带进消息", async () => {
	await withGoal(async ({ h, mod }) => {
		await h.run("goal", "start 修复登录缺陷 --autopilot");
		await callGoalTool(h, { action: "update", progress: "定位到 session 校验" });

		await h.emit("agent_settled");

		assert.equal(mod.getGoalState().turnsUsed, 1);
		const sent = h.userMessages.at(-1) ?? "";
		assert.match(sent, /修复登录缺陷/);
		assert.match(sent, /定位到 session 校验/, "带上最新进度，模型才知道从哪继续");
		assert.match(sent, /本轮次：1\/5/);
	});
});

test("focused 策略不会自动推进", async () => {
	await withGoal(async ({ h, mod }) => {
		await h.run("goal", "start 修复登录缺陷");

		await h.emit("agent_settled");

		assert.equal(mod.getGoalState().turnsUsed, 0);
		assert.equal(h.userMessages.length, 0, "focused 只在用户发起的轮次里保持目标");
	});
});

test("达到轮次上限后自动暂停，不再发消息", async () => {
	await withGoal(
		async ({ h, mod }) => {
			await h.run("goal", "start 修复登录缺陷 --autopilot");

			await h.emit("agent_settled");
			await h.emit("agent_settled");
			assert.equal(mod.getGoalState().turnsUsed, 2);
			assert.equal(h.userMessages.length, 2);

			// 第 3 次：turnsUsed 已等于上限，这里必须刹住。
			await h.emit("agent_settled");

			const state = mod.getGoalState();
			assert.equal(state.status, "paused");
			assert.equal(state.turnsUsed, 2, "刹住的那次不该再计一轮");
			assert.equal(h.userMessages.length, 2, "刹住之后不能再触发新一轮");
			assert.equal(h.notes.at(-1)?.level, "warning");
			assert.equal(h.lastEntry("goal-mode")?.status, "paused");
		},
		{ maxAutoTurns: 2 },
	);
});

test("plan 模式在等批准时 autopilot 不推进", async () => {
	// isPlanModeActive() 读的是 plan-mode 的模块级状态，这里驱动真实模块而不是打桩，
	// 免得两边对「什么算 plan 模式生效」的理解各走各的。
	const planHarness = makeHarness();
	planModeExtension(planHarness.pi);
	await planHarness.run("plan", "on");
	try {
		await withGoal(async ({ h, mod }) => {
			await h.run("goal", "start 修复登录缺陷 --autopilot");

			await h.emit("agent_settled");

			assert.equal(mod.getGoalState().turnsUsed, 0);
			assert.equal(h.userMessages.length, 0);
			assert.match(mod.getGoalState().progress, /等待计划批准/);
			assert.equal(mod.getGoalState().status, "active", "只是不推进，不算暂停");
		});
	} finally {
		await planHarness.run("plan", "off");
	}
});

test("有待处理消息时 autopilot 让位给用户", async () => {
	await withGoal(async ({ h, mod }) => {
		await h.run("goal", "start 修复登录缺陷 --autopilot");
		h.pendingMessages = true;

		await h.emit("agent_settled");

		assert.equal(mod.getGoalState().turnsUsed, 0);
		assert.equal(h.userMessages.length, 0);
		assert.match(mod.getGoalState().progress, /待处理消息/);
	});
});

test("用户中止当前轮次后 autopilot 暂停", async () => {
	await withGoal(async ({ h, mod }) => {
		await h.run("goal", "start 修复登录缺陷 --autopilot");

		await h.emit("turn_end", { message: ASSISTANT_ABORTED });

		assert.equal(mod.getGoalState().status, "paused");
		assert.equal(h.lastEntry("goal-mode")?.status, "paused");
		// 暂停之后 agent_settled 也不该再推进。
		await h.emit("agent_settled");
		assert.equal(h.userMessages.length, 0);
	});
});

test("正常结束的轮次不影响 autopilot", async () => {
	await withGoal(async ({ h, mod }) => {
		await h.run("goal", "start 修复登录缺陷 --autopilot");

		await h.emit("turn_end", { message: { role: "assistant", content: [], stopReason: "stop" } });

		assert.equal(mod.getGoalState().status, "active");
	});
});

test("pause / resume 只在合法状态下生效", async () => {
	await withGoal(async ({ h, mod }) => {
		// inactive 时 pause 无效。
		await h.run("goal", "pause");
		assert.equal(mod.getGoalState().status, "inactive");
		assert.equal(h.notes.at(-1)?.level, "warning");

		await h.run("goal", "start 修复登录缺陷");
		// active 时 resume 无意义，要告警而不是静默。
		await h.run("goal", "resume");
		assert.equal(h.notes.at(-1)?.level, "warning");
		assert.equal(mod.getGoalState().status, "active");

		await h.run("goal", "pause");
		assert.equal(mod.getGoalState().status, "paused");
		await h.run("goal", "resume");
		assert.equal(mod.getGoalState().status, "active");
	});
});

test("goal 工具的 update / block / complete 各自认状态", async () => {
	await withGoal(async ({ h, mod }) => {
		// 还没开始目标：update 与 block 都该拒绝。
		assert.match(await callGoalTool(h, { action: "update", progress: "x" }), /无法更新进度/);
		assert.match(await callGoalTool(h, { action: "block", reason: "缺少凭据" }), /无法阻塞/);
		assert.match(await callGoalTool(h, { action: "complete", summary: "x" }), /没有进行中的 Goal/);

		await h.run("goal", "start 修复登录缺陷");
		assert.match(await callGoalTool(h, { action: "update", progress: "改了一半" }), /进度已更新/);
		assert.equal(mod.getGoalState().progress, "改了一半");

		assert.match(await callGoalTool(h, { action: "block", reason: "缺少凭据" }), /已标记为阻塞/);
		assert.equal(mod.getGoalState().status, "blocked");
		// blocked 之后不能再 block 第二次，但可以 resume 回来。
		assert.match(await callGoalTool(h, { action: "block", reason: "又一个" }), /无法阻塞/);
		await h.run("goal", "resume");
		assert.equal(mod.getGoalState().status, "active");

		assert.match(await callGoalTool(h, { action: "complete", summary: "已修好" }), /Goal 已完成/);
		const done = mod.getGoalState();
		assert.equal(done.status, "completed");
		assert.equal(done.summary, "已修好");
		assert.equal(done.progress, "", "完成后不留半截进度");
		// completed 之后 autopilot 不该再推进。
		await h.emit("agent_settled");
		assert.equal(h.userMessages.length, 0);
	});
});

test("status 报告目标、状态与轮次", async () => {
	await withGoal(async ({ h }) => {
		await h.run("goal", "start 修复登录缺陷 --autopilot");
		await h.emit("agent_settled");

		const text = await callGoalTool(h, { action: "status" });

		assert.match(text, /目标: 修复登录缺陷/);
		assert.match(text, /状态: active/);
		assert.match(text, /轮次: 1\/5/);
	});
});

test("clear 把状态清回 inactive", async () => {
	await withGoal(async ({ h, mod }) => {
		await h.run("goal", "start 修复登录缺陷 --autopilot");
		await h.run("goal", "clear");

		const state = mod.getGoalState();
		assert.equal(state.status, "inactive");
		assert.equal(state.text, "");
		assert.equal(h.lastEntry("goal-mode")?.status, "inactive");
		await h.emit("agent_settled");
		assert.equal(h.userMessages.length, 0);
	});
});

test("重启后从当前分支恢复目标，废弃分支的不算", async () => {
	await withGoal(async ({ h, mod }) => {
		h.entries.push({
			id: "e1",
			type: "custom",
			customType: "goal-mode",
			data: {
				text: "修复登录缺陷",
				status: "active",
				strategy: "autopilot",
				turnsUsed: 2,
				maxTurns: 5,
				progress: "定位到 session 校验",
			},
		});
		// 文件顺序里排在后面、但已被 rewind 抛弃的另一条分支。
		h.stray.push({
			id: "s1",
			type: "custom",
			customType: "goal-mode",
			data: { text: "另一条路上的目标", status: "active", strategy: "focused", turnsUsed: 0, maxTurns: 5, progress: "" },
		});

		await h.emit("session_start");

		const state = mod.getGoalState();
		assert.equal(state.text, "修复登录缺陷", "恢复的应是当前分支的目标");
		assert.equal(state.turnsUsed, 2, "轮次要接着算，否则 autopilot 的上限会被重置");
		assert.equal(state.strategy, "autopilot");
		assert.equal(state.progress, "定位到 session 校验");
	});
});

test("没有 goal entry 时重启为 inactive，轮次上限取配置", async () => {
	await withGoal(
		async ({ h, mod }) => {
			await h.emit("session_start");

			const state = mod.getGoalState();
			assert.equal(state.status, "inactive");
			assert.equal(state.maxTurns, 7);
		},
		{ maxAutoTurns: 7 },
	);
});
