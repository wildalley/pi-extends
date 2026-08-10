import { test } from "node:test";
import assert from "node:assert/strict";
import {
	DEFAULT_ROUTE_FALLBACKS,
	ROUTE_NAMES,
	defaultConfig,
	isValidRouteName,
	resolveRoute,
	sanitizeConfig,
	type PiExtendsConfig,
} from "../extensions/pi-extends/config.ts";
import { formatRouteDiagnostics, resolveRuntimeRoute } from "../extensions/pi-extends/route-runtime.ts";
import { switchToRoute } from "../extensions/pi-extends/routes.ts";

function model(provider: string, id: string, input: ("text" | "image")[] = ["text"]): any {
	return { provider, id, input };
}

function withRoutes(routes: PiExtendsConfig["routes"]): PiExtendsConfig {
	return { ...defaultConfig(), routes };
}

test("每条路由都有回退链定义与合法性判断", () => {
	for (const route of ROUTE_NAMES) {
		assert.ok(Array.isArray(DEFAULT_ROUTE_FALLBACKS[route]), route);
		assert.ok(isValidRouteName(route));
	}
	assert.equal(DEFAULT_ROUTE_FALLBACKS.default.length, 0);
	assert.ok(!isValidRouteName("designer2"));
});

test("resolveRoute 命中自身配置", () => {
	const config = withRoutes({ smol: { model: "a/b", thinking: "low" } });
	assert.deepEqual(resolveRoute(config, "smol"), {
		route: "smol",
		model: "a/b",
		thinking: "low",
	});
});

test("resolveRoute 沿默认回退链找模型，thinking 取链上第一个显式值", () => {
	// plan 只配 thinking，模型沿 plan → slow → default 找。
	const config = withRoutes({
		plan: { thinking: "high" },
		slow: {},
		default: { model: "d/d", thinking: "off" },
	});
	assert.deepEqual(resolveRoute(config, "plan"), {
		route: "default",
		model: "d/d",
		thinking: "high",
	});
});

test("resolveRoute 全空时回落到主模型", () => {
	const config = withRoutes({});
	const resolved = resolveRoute(config, "vision");
	assert.equal(resolved.route, null);
	assert.equal(resolved.model, config.currentModel.model);
	assert.equal(resolved.thinking, config.currentModel.thinking);
});

test("resolveRoute 自定义回退链优先于默认链", () => {
	const config = withRoutes({
		tiny: { fallback: ["vision"] },
		vision: { model: "v/v" },
		smol: { model: "s/s" },
	});
	assert.equal(resolveRoute(config, "tiny").model, "v/v");
});

test("resolveRoute 遇到环不会死循环", () => {
	const config = withRoutes({
		smol: { fallback: ["tiny"] },
		tiny: { fallback: ["smol"] },
	});
	const resolved = resolveRoute(config, "smol");
	assert.equal(resolved.route, null);
	assert.equal(resolved.model, config.currentModel.model);
});

test("运行时路由跳过未注册和未认证模型并继续 fallback", () => {
	const config = withRoutes({
		plan: { model: "missing/plan", thinking: "high", fallback: ["slow", "default"] },
		slow: { model: "vendor/slow" },
		default: { model: "vendor/default" },
	});
	const slow = model("vendor", "slow");
	const fallback = model("vendor", "default");
	const resolved = resolveRuntimeRoute(config, "plan", {
		all: [slow, fallback],
		available: [fallback],
	});
	assert.equal(resolved.modelId, "vendor/default");
	assert.equal(resolved.source, "default");
	assert.equal(resolved.thinking, "high");
	assert.deepEqual(resolved.attempts.map((attempt) => attempt.status), [
		"unregistered",
		"unauthenticated",
		"selected",
	]);
	assert.match(formatRouteDiagnostics(resolved), /未注册/);
	assert.match(formatRouteDiagnostics(resolved), /未认证/);
});

test("运行时路由按能力过滤并最终回退到当前活动模型", () => {
	const config = withRoutes({ vision: { model: "vendor/text", fallback: [] } });
	config.currentModel.model = "missing/current";
	const text = model("vendor", "text");
	const active = model("vendor", "vision", ["text", "image"]);
	const resolved = resolveRuntimeRoute(
		config,
		"vision",
		{ all: [text, active], available: [text, active], active },
		{ require: (candidate) => candidate.input.includes("image"), requireLabel: "需要 image 输入" },
	);
	assert.equal(resolved.modelId, "vendor/vision");
	assert.equal(resolved.source, "active");
	assert.deepEqual(resolved.attempts.map((attempt) => attempt.status), [
		"incompatible",
		"unregistered",
		"selected",
	]);
	assert.match(formatRouteDiagnostics(resolved), /能力不匹配/);
});

test("主会话路由消费者执行切换并输出降级诊断", async () => {
	const config = withRoutes({
		commit: { model: "missing/commit", fallback: ["smol"] },
		smol: { model: "vendor/smol", thinking: "low" },
	});
	const target = model("vendor", "smol");
	const notes: { text: string; level?: string }[] = [];
	const ctx = {
		modelRegistry: {
			getAll: () => [target],
			getAvailable: () => [target],
		},
		model: model("vendor", "active"),
		ui: { notify: (text: string, level?: string) => notes.push({ text, level }) },
	} as any;
	const calls: string[] = [];
	const pi = {
		setModel: async (selected: any) => {
			calls.push(`model:${selected.provider}/${selected.id}`);
			return true;
		},
		setThinkingLevel: (level: string) => calls.push(`thinking:${level}`),
	};

	const resolved = await switchToRoute(pi, ctx, config, "commit");
	assert.equal(resolved.modelId, "vendor/smol");
	assert.deepEqual(calls, ["model:vendor/smol", "thinking:low"]);
	assert.match(notes[0]?.text ?? "", /未注册/);
});

test("sanitizeConfig 丢弃非法路由、非法模型与自指回退", () => {
	const { config, warnings } = sanitizeConfig({
		version: 1,
		routes: {
			smol: { model: "not a model", thinking: "turbo", fallback: ["smol", "nope", "slow"] },
			nosuchroute: { model: "a/b" },
		},
	});
	// 基线为空，非法值被丢弃后该字段就是「未配置」，而不是回落到某个默认模型。
	assert.equal(config.routes.smol?.model, undefined);
	assert.equal(config.routes.smol?.thinking, undefined);
	assert.deepEqual(config.routes.smol?.fallback, ["slow"]);
	assert.ok(!("nosuchroute" in config.routes));
	assert.ok(warnings.some((w) => w.includes("未知路由")));
	assert.ok(warnings.some((w) => w.includes("不能回退到自己")));
});

test("sanitizeConfig 逐字段覆盖 advisor 与 keywords", () => {
	const base = sanitizeConfig({ version: 1, advisor: { enabled: true, maxPerSession: 3 } }).config;
	assert.equal(base.advisor.enabled, true);
	assert.equal(base.advisor.maxPerSession, 3);
	// 未出现的字段继承 base。
	const next = sanitizeConfig({ version: 1, advisor: { minSeverity: "blocker" } }, base).config;
	assert.equal(next.advisor.enabled, true);
	assert.equal(next.advisor.maxPerSession, 3);
	assert.equal(next.advisor.minSeverity, "blocker");
	assert.equal(next.keywords.enabled, true);
	const off = sanitizeConfig({ version: 1, keywords: { enabled: false } }, base).config;
	assert.equal(off.keywords.enabled, false);
});

test("sanitizeConfig 对非法 advisor 值给出警告并保留原值", () => {
	const { config, warnings } = sanitizeConfig({
		version: 1,
		advisor: { minSeverity: "urgent", maxPerSession: 0, enabled: "yes" },
	});
	assert.equal(config.advisor.minSeverity, defaultConfig().advisor.minSeverity);
	assert.equal(config.advisor.maxPerSession, defaultConfig().advisor.maxPerSession);
	assert.equal(config.advisor.enabled, defaultConfig().advisor.enabled);
	assert.equal(warnings.filter((w) => w.startsWith("advisor.")).length, 3);
});
