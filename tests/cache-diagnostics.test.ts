import { test } from "node:test";
import assert from "node:assert/strict";
import {
	buildCacheDiagnostics,
	cachePromptStatus,
	formatCacheDiagnostics,
} from "../extensions/pi-extends/cache-diagnostics.ts";
import { emptyBase, type PiExtendsConfig } from "../extensions/pi-extends/config.ts";

function relay(metrics: "reported" | "unreported", anthropicCacheControl: boolean): PiExtendsConfig {
	const config = emptyBase();
	config.providers = [{
		id: "relay",
		name: "Relay",
		baseUrl: "https://relay.example.com/v1",
		api: "openai-completions",
		apiKeyEnv: "RELAY_KEY",
		cache: { metrics, anthropicCacheControl, supportsLongRetention: false },
		models: [{ id: "model" }],
	}];
	return config;
}

function entry(input: number, cacheRead: number, cacheWrite: number) {
	return {
		type: "message",
		message: {
			role: "assistant",
			provider: "relay",
			model: "model",
			usage: { input, output: 10, cacheRead, cacheWrite },
		},
	};
}

test("诊断能区分已发缓存提示、可信零命中与中转指标未知", () => {
	const zero = buildCacheDiagnostics([entry(1000, 0, 0)], relay("reported", true));
	assert.equal(zero[0]?.promptStatus, "sent");
	assert.equal(zero[0]?.metricsStatus, "zero");
	assert.match(zero[0]?.conclusion ?? "", /可能忽略/);

	const unknown = buildCacheDiagnostics([entry(1000, 0, 0)], relay("unreported", true));
	assert.equal(unknown[0]?.metricsStatus, "unknown");
	assert.match(unknown[0]?.conclusion ?? "", /可能命中但未回传/);
});

test("未配置兼容缓存标记的 OpenAI Completions 中转显示 Pi 未发提示", () => {
	const config = relay("reported", false);
	assert.equal(cachePromptStatus(undefined, config, "relay"), "not-sent");
	const rows = buildCacheDiagnostics([entry(1000, 0, 0)], config);
	assert.match(rows[0]?.conclusion ?? "", /Pi 未发送/);
});

test("缓存读取产生命中率，并按最近回合倒序和数量截断", () => {
	const rows = buildCacheDiagnostics(
		[entry(100, 100, 0), entry(50, 150, 0)],
		relay("unreported", true),
		[],
		1,
	);
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.metricsStatus, "hit");
	assert.equal(rows[0]?.hitRate, 75);
	assert.match(formatCacheDiagnostics(rows), /命中 75\.0%/);
});
