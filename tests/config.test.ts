import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	atomicWriteJson,
	defaultConfig,
	isValidBaseUrl,
	isValidEnvVarName,
	isValidModelId,
	isValidPositiveInt,
	isValidProviderId,
	isValidRoleName,
	isValidThinkingLevel,
	isValidToolName,
	loadConfigFiles,
	sanitizeConfig,
} from "../extensions/pi-extends/config.ts";

function tmpDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "pi-extends-test-"));
}

test("默认配置可直接使用", () => {
	const config = defaultConfig();
	assert.equal(config.version, 1);
	assert.equal(config.theme, "pi-carbon");
	assert.equal(config.goal.maxAutoTurns, 5);
	assert.deepEqual(Object.keys(config.roles).sort(), ["planner", "reviewer", "scout", "worker"]);
	assert.equal(config.subagents.maxConcurrency, 4);
});

test("空配置回退默认值并给出警告", () => {
	const result = sanitizeConfig(undefined);
	assert.deepEqual(result.config, defaultConfig());
	assert.ok(result.warnings.length > 0);
});

test("损坏 JSON 文件产生可理解警告并回退", () => {
	const dir = tmpDir();
	const bad = path.join(dir, "pi-extends.json");
	fs.writeFileSync(bad, "{ not json ", "utf8");
	const result = loadConfigFiles({ userPath: bad });
	assert.equal(result.config.theme, "pi-carbon");
	assert.ok(result.warnings.some((w) => w.includes(bad)));
});

test("部分覆盖只影响给出的字段", () => {
	const dir = tmpDir();
	const user = path.join(dir, "user.json");
	fs.writeFileSync(
		user,
		JSON.stringify({ theme: "pi-paper", roles: { scout: { model: "x/a" } } }),
		"utf8",
	);
	const project = path.join(dir, "project.json");
	fs.writeFileSync(project, JSON.stringify({ theme: "pi-contrast" }), "utf8");
	const result = loadConfigFiles({ userPath: user, projectPath: project });
	assert.equal(result.config.theme, "pi-contrast");
	assert.equal(result.config.roles.scout?.model, "x/a");
});

test("项目级 providers 整体替换用户级", () => {
	const dir = tmpDir();
	const user = path.join(dir, "user.json");
	const userProvider = [
		{
			id: "user-p",
			name: "User P",
			baseUrl: "https://user.example.com/v1",
			api: "openai-completions",
			apiKeyEnv: "USER_KEY",
			models: [{ id: "u-model", reasoning: false }],
		},
	];
	fs.writeFileSync(user, JSON.stringify({ providers: userProvider }), "utf8");
	const project = path.join(dir, "project.json");
	const projectProvider = [
		{
			id: "proj-p",
			name: "Proj P",
			baseUrl: "https://proj.example.com/v1",
			api: "anthropic-messages",
			apiKeyEnv: "PROJ_KEY",
			models: [{ id: "p-model", reasoning: true }],
		},
	];
	fs.writeFileSync(project, JSON.stringify({ providers: projectProvider }), "utf8");
	const result = loadConfigFiles({ userPath: user, projectPath: project });
	assert.deepEqual(result.config.providers, projectProvider);
});

test("项目级缺省字段继承用户级而非默认值", () => {
	const dir = tmpDir();
	const user = path.join(dir, "user.json");
	fs.writeFileSync(user, JSON.stringify({ theme: "pi-paper" }), "utf8");
	const project = path.join(dir, "project.json");
	fs.writeFileSync(project, JSON.stringify({ goal: { maxAutoTurns: 3 } }), "utf8");
	const result = loadConfigFiles({ userPath: user, projectPath: project });
	assert.equal(result.config.theme, "pi-paper");
	assert.equal(result.config.goal.maxAutoTurns, 3);
	assert.equal(result.config.subagents.maxConcurrency, defaultConfig().subagents.maxConcurrency);
});

test("角色按名称深度合并且未指定角色继承 base", () => {
	const base = defaultConfig();
	const result = sanitizeConfig({ roles: { scout: { model: "other/s" } } }, base);
	assert.equal(result.config.roles.scout?.model, "other/s");
	assert.deepEqual(result.config.roles.scout?.tools, base.roles.scout?.tools);
	assert.deepEqual(result.config.roles.planner, base.roles.planner);
});

test("无效 provider 被跳过并产生警告", () => {
	const result = sanitizeConfig({
		providers: [
			{ id: "ok", name: "OK", baseUrl: "https://ok.example.com", api: "openai-completions", apiKeyEnv: "OK_KEY", models: [{ id: "m" }] },
			{ id: "bad url", name: "Bad", baseUrl: "ftp://nope", api: "openai-completions", apiKeyEnv: "BAD_KEY", models: [{ id: "m" }] },
			{ id: "no-models", name: "NoM", baseUrl: "https://nom.example.com", api: "openai-completions", apiKeyEnv: "NOM_KEY", models: [] },
		],
	});
	assert.equal(result.config.providers.length, 1);
	assert.equal(result.config.providers[0]?.id, "ok");
	assert.ok(result.warnings.some((w) => w.includes("bad url")));
	assert.ok(result.warnings.some((w) => w.includes("未提供任何模型")));
});

test("无效字段产生警告但不阻止加载", () => {
	const result = sanitizeConfig({
		version: 99,
		theme: 42,
		roles: { hacker: {} },
		goal: { maxAutoTurns: -3 },
	});
	assert.equal(result.config.theme, "pi-carbon");
	assert.equal((result.config.roles as Record<string, unknown>).hacker, undefined);
	assert.equal(result.config.goal.maxAutoTurns, 5);
	assert.ok(result.warnings.length >= 3);
});

test("格式校验", () => {
	assert.ok(isValidModelId("anthropic/claude-sonnet-4-5"));
	assert.ok(!isValidModelId(""));
	assert.ok(isValidProviderId("my-proxy"));
	assert.ok(!isValidProviderId("with space"));
	assert.ok(isValidEnvVarName("MY_LLM_API_KEY"));
	assert.ok(!isValidEnvVarName("1BAD"));
	assert.ok(isValidBaseUrl("https://api.example.com/v1"));
	assert.ok(!isValidBaseUrl("ftp://x"));
	assert.ok(!isValidBaseUrl("not a url"));
	assert.ok(isValidThinkingLevel("high"));
	assert.ok(!isValidThinkingLevel("turbo"));
	assert.ok(isValidToolName("read"));
	assert.ok(!isValidToolName("rm -rf"));
	assert.ok(isValidPositiveInt(4));
	assert.ok(!isValidPositiveInt(0));
	assert.ok(!isValidPositiveInt(4.5));
	assert.ok(isValidRoleName("worker"));
	assert.ok(!isValidRoleName("intern"));
});

test("atomicWriteJson 原子写入并保留内容", async () => {
	const dir = tmpDir();
	const target = path.join(dir, ".pi", "pi-extends.json");
	await atomicWriteJson(target, { version: 1, hello: "world" });
	const parsed = JSON.parse(fs.readFileSync(target, "utf8"));
	assert.equal(parsed.hello, "world");
	const leftovers = fs.readdirSync(path.dirname(target)).filter((f) => f.endsWith(".tmp"));
	assert.equal(leftovers.length, 0);
});
