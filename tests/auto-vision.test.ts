import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultConfig, type PiExtendsConfig } from "../extensions/pi-extends/config.ts";
import { modelId, resolveVisionModel, supportsImages } from "../extensions/pi-extends/auto-vision.ts";

function model(provider: string, id: string, input: ("text" | "image")[]): any {
	return { provider, id, input };
}

test("自动视觉路由按 vision 配置解析模型", () => {
	const config: PiExtendsConfig = {
		...defaultConfig(),
		routes: { vision: { model: "openai-codex/gpt-5.6-luna", thinking: "max" } },
	};
	const target = model("openai-codex", "gpt-5.6-luna", ["text", "image"]);
	const result = resolveVisionModel(config, [target]);

	assert.equal(result.route.model, "openai-codex/gpt-5.6-luna");
	assert.equal(result.model, target);
	assert.equal(modelId(target), "openai-codex/gpt-5.6-luna");
});

test("自动视觉路由能区分视觉模型与文本模型", () => {
	assert.equal(supportsImages(model("openai", "gpt-4o", ["text", "image"])), true);
	assert.equal(supportsImages(model("deepseek", "chat", ["text"])), false);
	assert.equal(supportsImages(undefined), false);
});

test("vision 路由模型未注册时返回空模型", () => {
	const config = defaultConfig();
	config.routes.vision = { model: "missing/vision" };
	const result = resolveVisionModel(config, []);
	assert.equal(result.model, undefined);
});

test("vision 解析跳过不支持 image 的首选模型并选择回退模型", () => {
	const config = defaultConfig();
	config.routes.vision = { model: "vendor/text", fallback: ["default"] };
	config.routes.default = { model: "vendor/vision", thinking: "low" };
	const text = model("vendor", "text", ["text"]);
	const vision = model("vendor", "vision", ["text", "image"]);
	const result = resolveVisionModel(config, [text, vision], [text, vision]);

	assert.equal(result.model, vision);
});
