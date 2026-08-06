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

test("sanitizeConfig 丢弃非法路由、非法模型与自指回退", () => {
	const { config, warnings } = sanitizeConfig({
		version: 1,
		routes: {
			smol: { model: "not a model", thinking: "turbo", fallback: ["smol", "nope", "slow"] },
			nosuchroute: { model: "a/b" },
		},
	});
	assert.equal(config.routes.smol?.model, defaultConfig().routes.smol?.model);
	assert.equal(config.routes.smol?.thinking, defaultConfig().routes.smol?.thinking);
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
