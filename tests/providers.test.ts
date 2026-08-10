import { test } from "node:test";
import assert from "node:assert/strict";
import {
	parseModelCostInput,
	probeProviderConnection,
	providerRegistrationConfig,
	removeProviderTransaction,
	saveProviderTransaction,
} from "../extensions/pi-extends/providers.ts";
import type { CustomProviderConfig } from "../extensions/pi-extends/config.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

function provider(id: string): CustomProviderConfig {
	return {
		id,
		name: id,
		baseUrl: `https://${id}.example.com/v1`,
		api: "openai-completions",
		apiKeyEnv: `${id.toUpperCase()}_KEY`,
		models: [{ id: "model" }],
	};
}

test("价格输入接受四个非负数字", () => {
	assert.deepEqual(parseModelCostInput("3, 15, 0.3, 3.75"), {
		input: 3,
		output: 15,
		cacheRead: 0.3,
		cacheWrite: 3.75,
	});
	assert.equal(parseModelCostInput(""), undefined);
	assert.equal(parseModelCostInput("1,2,3"), undefined);
	assert.equal(parseModelCostInput("1,-2,3,4"), undefined);
});

test("注册自定义 provider 时传递视觉、窗口和价格元数据", () => {
	const registration = providerRegistrationConfig({
		id: "relay",
		name: "Relay",
		baseUrl: "https://relay.example.com/v1",
		api: "openai-completions",
		apiKeyEnv: "RELAY_KEY",
		cache: { metrics: "reported", anthropicCacheControl: true, supportsLongRetention: true },
		models: [{
			id: "vision-model",
			input: ["text", "image"],
			contextWindow: 200000,
			maxTokens: 8192,
			cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
		}],
	});
	assert.deepEqual(registration.models[0], {
		id: "vision-model",
		name: "vision-model",
		reasoning: false,
		input: ["text", "image"],
		contextWindow: 200000,
		maxTokens: 8192,
		cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
		compat: { cacheControlFormat: "anthropic", supportsLongCacheRetention: true },
	});
});

test("保存配置失败时撤销新注册并恢复旧 provider", async () => {
	const calls: string[] = [];
	const previous = { ...provider("relay"), name: "old relay" };
	const result = await saveProviderTransaction(provider("relay"), previous, {
		register: (config) => {
			calls.push(`register:${config.id}`);
			return undefined;
		},
		unregister: (id) => calls.push(`unregister:${id}`),
		persist: async () => {
			calls.push("persist");
			throw new Error("disk full");
		},
	});
	assert.deepEqual(calls, ["register:relay", "persist", "unregister:relay", "register:relay"]);
	assert.deepEqual(result, { ok: false, phase: "persist", error: "disk full" });
});

test("注册失败时不写配置，移除写盘失败时恢复 provider", async () => {
	let persisted = false;
	const rejected = await saveProviderTransaction(provider("relay"), undefined, {
		register: () => "duplicate id",
		unregister: () => {},
		persist: async () => { persisted = true; },
	});
	assert.deepEqual(rejected, { ok: false, phase: "register", error: "duplicate id" });
	assert.equal(persisted, false);

	const calls: string[] = [];
	const removed = await removeProviderTransaction(provider("relay"), {
		register: (config) => {
			calls.push(`register:${config.id}`);
			return undefined;
		},
		unregister: (id) => calls.push(`unregister:${id}`),
		persist: async () => {
			calls.push("persist");
			throw new Error("read only");
		},
	});
	assert.deepEqual(calls, ["unregister:relay", "persist", "register:relay"]);
	assert.deepEqual(removed, { ok: false, phase: "persist", error: "read only" });
});

test("项目级 providers 遮蔽用户级修改时恢复实际运行时配置", async () => {
	const calls: string[] = [];
	const requested = { ...provider("relay"), name: "user relay" };
	const effective = { ...provider("relay"), name: "project relay" };
	const saved = await saveProviderTransaction(requested, effective, {
		register: (config) => {
			calls.push(`register:${config.name}`);
			return undefined;
		},
		unregister: (id) => calls.push(`unregister:${id}`),
		persist: async () => { calls.push("persist"); },
		effective: () => effective,
	});
	assert.deepEqual(calls, [
		"register:user relay",
		"persist",
		"unregister:relay",
		"register:project relay",
	]);
	assert.deepEqual(saved, {
		ok: false,
		phase: "effective",
		error: "用户级修改被项目级 providers 覆盖",
	});

	calls.length = 0;
	const removed = await removeProviderTransaction(effective, {
		register: (config) => {
			calls.push(`register:${config.name}`);
			return undefined;
		},
		unregister: (id) => calls.push(`unregister:${id}`),
		persist: async () => { calls.push("persist"); },
		effective: () => effective,
	});
	assert.deepEqual(calls, ["unregister:relay", "persist", "register:project relay"]);
	assert.deepEqual(removed, {
		ok: false,
		phase: "effective",
		error: "用户级修改被项目级 providers 覆盖",
	});
});

test("连接测试会使用已注册模型发送最小请求", async () => {
	const seen: { maxTokens?: number; prompt?: string } = {};
	const ctx = {
		modelRegistry: {
			find: () => ({ id: "model", provider: "relay" }),
			getProvider: () => ({
				streamSimple: (_model: unknown, context: any, options: any) => {
					seen.maxTokens = options.maxTokens;
					seen.prompt = context.messages[0]?.content;
					return (async function* () { yield { type: "done" }; })();
				},
			}),
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "secret", headers: {} }),
		},
	} as unknown as ExtensionContext;
	const result = await probeProviderConnection(ctx, provider("relay"));
	assert.deepEqual(result, { ok: true, message: "relay/model 请求成功" });
	assert.deepEqual(seen, { maxTokens: 1, prompt: "Reply with OK." });
});
