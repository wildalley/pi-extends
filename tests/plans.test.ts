/**
 * Coding plan 目录 vs pi 的真实 provider 目录。
 *
 * plans.ts 里剩下的「关于 pi 的断言」只有两类：provider id 和环境变量名。
 * 这两样都是我照着 pi 的 docs/providers.md 和 env-api-keys 核对出来的，
 * 而手工核对只在核对那一刻成立 —— pi 升级换了 id 或换了变量名，
 * 用户看到的就是一份把人指错方向的说明。所以把核对固化成测试。
 *
 * 认证能力（订阅 / API Key）已经改成运行时从 provider 上读，不在这里断言；
 * 但分组是写死的，「订阅套餐」这一组必须真的支持订阅登录，否则分组在骗人。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import {
	CODING_PLANS,
	authLabel,
	envVarsOf,
	setupSteps,
	statusOf,
	type CodingPlan,
	type PlanStatus,
} from "../extensions/pi-extends/plans.ts";

const providers = new Map(builtinProviders().map((p) => [p.id, p] as const));

/**
 * `findEnvKeys` 不在 pi-ai 的 exports map 里，只能按文件路径进。
 * 刻意不做「找不到就跳过」：这个测试的价值就是发现上游变动，静默跳过等于关掉警报。
 * exports map 只声明 import 条件，所以用 import.meta.resolve 拿主入口再找兄弟文件。
 */
const envKeysUrl = import.meta
	.resolve("@earendil-works/pi-ai")
	.replace(/index\.js$/, "env-api-keys.js");
const { findEnvKeys } = (await import(envKeysUrl)) as {
	findEnvKeys(provider: string, env?: Record<string, string>): string[] | undefined;
};

/** 目录里出现过的所有变量名，用来探测某个 provider 到底认不认环境变量。 */
const ALL_ENV: Record<string, string> = {};
for (const plan of CODING_PLANS) {
	for (const name of envVarsOf(plan)) {
		ALL_ENV[name] = "probe";
	}
}

/** 造一个 PlanStatus，只填被测函数会读的字段。 */
function fakeStatus(plan: CodingPlan, over: Partial<PlanStatus> = {}): PlanStatus {
	return {
		plan,
		registered: true,
		authenticated: false,
		modelCount: 0,
		envSet: false,
		subscription: false,
		keyLogin: false,
		...over,
	};
}

test("每个 coding plan 的 id 都是 pi 的内置 provider", () => {
	const missing = CODING_PLANS.filter((p) => !providers.has(p.id)).map((p) => p.id);
	assert.deepEqual(missing, [], `这些 id 在 pi 里不存在，可能被上游改名了：${missing.join(", ")}`);
});

test("目录里没有重复 id", () => {
	const ids = CODING_PLANS.map((p) => p.id);
	assert.equal(new Set(ids).size, ids.length);
});

test("每条 env 都是 pi 认的变量名", () => {
	for (const plan of CODING_PLANS) {
		if (!plan.env) continue;
		// findEnvKeys 会把传进来的 env 和 process.env 合起来看，所以这里只断言
		// 「pi 认这个变量」，不断言「只认这一个」—— 跑测试的机器上很可能真的
		// 设了别的变量（我自己的机器就设了 ANTHROPIC_AUTH_TOKEN）。
		const accepted = findEnvKeys(plan.id, { [plan.env]: "probe" }) ?? [];
		assert.ok(
			accepted.includes(plan.env),
			`${plan.id} 不认 ${plan.env}；pi 认的是 ${JSON.stringify(accepted)}`,
		);
	}
});

test("别名变量也是 pi 认的（否则「未设置」提示会误报）", () => {
	// envVarsOf 里除主变量外的都是别名。
	for (const plan of CODING_PLANS) {
		for (const name of envVarsOf(plan).slice(1)) {
			const accepted = findEnvKeys(plan.id, { [name]: "probe" }) ?? [];
			assert.ok(accepted.includes(name), `${plan.id} 不认别名 ${name}`);
		}
	}
});

test("没写 env 的厂商确实没有环境变量可用", () => {
	// 把目录里所有变量都塞进去，pi 仍然说没有，才能证明「只能 /login」这句话是对的。
	for (const plan of CODING_PLANS) {
		if (plan.env) continue;
		assert.equal(
			findEnvKeys(plan.id, ALL_ENV),
			undefined,
			`${plan.id} 其实认环境变量，目录里却没写，指引会漏掉非交互的办法`,
		);
	}
});

test("「订阅套餐」这一组必须真的支持订阅登录", () => {
	for (const plan of CODING_PLANS.filter((p) => p.group === "订阅套餐")) {
		const provider = providers.get(plan.id);
		assert.ok(provider?.auth.oauth, `${plan.id} 被归到订阅套餐，但 pi 没给它 OAuth`);
	}
});

test("「编码套餐」「直连 API」两组只走 API Key", () => {
	for (const plan of CODING_PLANS.filter((p) => p.group !== "订阅套餐")) {
		const provider = providers.get(plan.id);
		assert.ok(
			!provider?.auth.oauth,
			`${plan.id} 已经支持订阅登录了，该挪到「订阅套餐」组`,
		);
	}
});

test("开通指引第一条永远是 /login，因为它对所有厂商都有效", () => {
	for (const plan of CODING_PLANS) {
		const steps = setupSteps(fakeStatus(plan));
		assert.ok(steps[0]?.includes(`/login ${plan.id}`), `${plan.id} 的第一条不是 /login`);
	}
});

test("有 env 的厂商会给出非交互办法，没有的会说清只能 /login", () => {
	const withEnv = CODING_PLANS.find((p) => p.env);
	const withoutEnv = CODING_PLANS.find((p) => !p.env);
	assert.ok(withEnv && withoutEnv, "目录里应当同时存在两种厂商");

	const a = setupSteps(fakeStatus(withEnv)).join("\n");
	assert.ok(a.includes(`export ${withEnv.env}=`));
	assert.ok(a.includes("优先于环境变量"));

	const b = setupSteps(fakeStatus(withoutEnv)).join("\n");
	assert.ok(!b.includes("export "));
	assert.ok(b.includes("只能走 /login"));
});

test("订阅 + Key 双通道时，指引要提示可以选", () => {
	const plan = CODING_PLANS[0] as CodingPlan;
	const both = setupSteps(fakeStatus(plan, { subscription: true, keyLogin: true })).join("\n");
	assert.ok(both.includes("用订阅"));

	const oauthOnly = setupSteps(fakeStatus(plan, { subscription: true, keyLogin: false })).join("\n");
	assert.ok(oauthOnly.includes("浏览器"));

	const keyOnly = setupSteps(fakeStatus(plan, { subscription: false })).join("\n");
	assert.ok(keyOnly.includes("粘贴 API Key"));
});

test("认证方式标签跟着 provider 的真实能力变", () => {
	const plan = CODING_PLANS.find((p) => p.env) as CodingPlan;
	assert.equal(authLabel(fakeStatus(plan, { subscription: true, keyLogin: true })), "订阅 / Key");
	assert.equal(authLabel(fakeStatus(plan, { subscription: false })), "API Key");

	const noEnv = CODING_PLANS.find((p) => !p.env) as CodingPlan;
	assert.equal(authLabel(fakeStatus(noEnv, { subscription: true, keyLogin: false })), "订阅登录");
});

test("四种状态互相区分得开", () => {
	const plan = CODING_PLANS[0] as CodingPlan;

	const stored = statusOf(fakeStatus(plan, { authenticated: true, source: "stored", modelCount: 7 }));
	assert.equal(stored.tone, "success");
	assert.ok(stored.text.includes("已登录") && stored.text.includes("7"));

	const viaEnv = statusOf(
		fakeStatus(plan, { authenticated: true, source: "environment", modelCount: 3 }),
	);
	assert.ok(viaEnv.text.includes("变量"));

	// 变量配了却没生效，是最需要单独提示的一种。
	const stuck = statusOf(fakeStatus(plan, { envSet: true }));
	assert.equal(stuck.tone, "warning");

	assert.equal(statusOf(fakeStatus(plan, { registered: false })).text, "本版本未提供");
	assert.equal(statusOf(fakeStatus(plan)).text, "未认证");
});

test("状态判定优先看 pi 的结论，不看环境变量", () => {
	// 变量没设但 auth.json 里有凭据 —— 必须算已认证。
	const plan = CODING_PLANS[0] as CodingPlan;
	const row = fakeStatus(plan, { authenticated: true, source: "stored", envSet: false });
	assert.equal(statusOf(row).tone, "success");
});
