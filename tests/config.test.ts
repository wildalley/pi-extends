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
	applyPatch,
	diffConfig,
	emptyBase,
	schemaRefFrom,
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

test("空配置回退到空基线并给出警告", () => {
	const result = sanitizeConfig(undefined);
	// 基线不再是 defaultConfig()：加载链从空开始，否则用户的删除操作会被默认值复活。
	assert.deepEqual(result.config, emptyBase());
	assert.deepEqual(result.config.roles, {});
	assert.deepEqual(result.config.routes, {});
	assert.ok(result.warnings.length > 0);
});

test("exact 模式让删除操作真正落盘，不被默认值复活", () => {
	// 模拟 routes.ts 的 clear-model：从一份「已配置」的文档里删掉 model。
	const configured = sanitizeConfig({
		version: 1,
		routes: { smol: { model: "google/gemini-2.5-flash", thinking: "low" } },
		roles: { scout: { model: "a/b", tools: ["read", "grep"] } },
	}).config;

	delete configured.routes.smol!.model;
	delete configured.roles.scout!.tools;

	const written = sanitizeConfig(configured, emptyBase(), "exact").config;
	assert.equal(written.routes.smol?.model, undefined, "清除后不应再出现 model");
	assert.equal(written.routes.smol?.thinking, "low", "同级其他字段要保留");
	assert.equal(written.roles.scout?.tools, undefined, "清除后不应再出现 tools");
	assert.equal(written.roles.scout?.model, "a/b");
});

test("inherit 模式仍然逐层继承，用于加载链", () => {
	const user = sanitizeConfig({ version: 1, theme: "pi-sakura" }).config;
	const merged = sanitizeConfig({ version: 1, currentModel: { model: "x/y" } }, user).config;
	assert.equal(merged.theme, "pi-sakura", "未出现的字段继承上一层");
	assert.equal(merged.currentModel.model, "x/y");
});

test("diffConfig 只报告真实变化，删除表示为 undefined", () => {
	const prev = { theme: "a", currentModel: { model: "m", thinking: "high" }, routes: { smol: { model: "s" } } };
	const next = { theme: "b", currentModel: { model: "m", thinking: "high" }, routes: { smol: {} } };
	const patch = diffConfig(prev, next) as Record<string, any>;
	assert.equal(patch.theme, "b");
	assert.equal("currentModel" in patch, false, "未变化的子树不应出现");
	assert.ok("model" in patch.routes.smol, "删除的键要出现");
	assert.equal(patch.routes.smol.model, undefined);
});

test("diffConfig 无变化时返回 undefined", () => {
	assert.equal(diffConfig({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }), undefined);
});

test("applyPatch 把改动应用到目标层，不带入其他层的值", () => {
	// 用户级只有主模型；项目级设了主题，合并后 theme=pi-paper。
	const userRaw = { version: 1, currentModel: { model: "openai/gpt-5.2" } };
	const mergedPrev = { version: 1, theme: "pi-paper", currentModel: { model: "openai/gpt-5.2" } };
	// 用户在 cockpit 里把主题改成 pi-sakura。
	const mergedNext = { ...mergedPrev, theme: "pi-sakura" };

	const patch = diffConfig(mergedPrev, mergedNext);
	const written = applyPatch(userRaw, patch) as Record<string, any>;

	assert.equal(written.theme, "pi-sakura", "改动要写进用户层");
	assert.equal(written.currentModel.model, "openai/gpt-5.2", "用户层原有值保留");
	assert.equal(
		JSON.stringify(written).includes("pi-paper"),
		false,
		"项目层的值不应被抄进用户层",
	);
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

test("icons 字段接受四套图标集，大小写与空格会归一化", () => {
	const base = emptyBase();
	for (const [input, want] of [
		["lucide", "lucide"],
		["nerd", "nerd"],
		["unicode", "unicode"],
		["ascii", "ascii"],
		// 配置文件是手写的，这两种笔误认出来比丢掉有用；归一化后的值随保存写回文件。
		["LUCIDE", "lucide"],
		["  nerd ", "nerd"],
	] as const) {
		const result = sanitizeConfig({ icons: input }, base, "inherit");
		assert.equal(result.config.icons, want, `icons: ${JSON.stringify(input)}`);
		assert.deepEqual(result.warnings, [], `icons: ${JSON.stringify(input)} 不该有警告`);
	}
});

test("icons 未知取值给出警告并保留基线值", () => {
	const base = { ...emptyBase(), icons: "nerd" as const };
	const result = sanitizeConfig({ icons: "emoji" }, base, "inherit");
	assert.equal(result.config.icons, "nerd");
	assert.equal(result.warnings.length, 1);
	assert.match(result.warnings[0], /icons/u);
	// 警告要把可选值列出来，否则用户还得翻文档才知道该填什么。
	assert.match(result.warnings[0], /lucide/u);
});

test("icons 缺省时继承上一层，不被默认值覆盖", () => {
	const base = { ...emptyBase(), icons: "ascii" as const };
	const result = sanitizeConfig({}, base, "inherit");
	assert.equal(result.config.icons, "ascii");
});

// $schema 指不到文件时不会报错，只是编辑器静默不校验 —— 所以只能靠断言守住：
// 从写盘目录出发解析那个字符串，落点必须真的存在。
test("写盘的 $schema 从配置文件所在目录能解析到真实的 schema 文件", () => {
	const dir = tmpDir();
	const configPath = path.join(dir, ".pi", "pi-extends.json");
	const ref = schemaRefFrom(configPath);
	const resolved = path.resolve(path.dirname(configPath), ref);
	assert.ok(fs.existsSync(resolved), `$schema "${ref}" 解析到 ${resolved}，该文件不存在`);
	const schema = JSON.parse(fs.readFileSync(resolved, "utf8"));
	assert.equal(typeof schema.properties, "object");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("$schema 用 POSIX 分隔符，不含反斜杠", () => {
	const dir = tmpDir();
	const ref = schemaRefFrom(path.join(dir, ".pi", "pi-extends.json"));
	assert.ok(!ref.includes("\\"), `$schema 不能含反斜杠：${ref}`);
	// 同盘时是相对引用；Windows 跨盘拿不到相对路径，退回 file:// URL。
	assert.ok(
		ref.startsWith(".") || ref.startsWith("file://"),
		`$schema 应为相对引用或 file:// URL：${ref}`,
	);
	fs.rmSync(dir, { recursive: true, force: true });
});

// schema 得跟着字段走：加了 border 却忘了写进 schema，编辑器就会把合法值标红。
test("schema 覆盖了 sanitizeConfig 认识的所有顶层字段", () => {
	const dir = tmpDir();
	const configDir = path.join(dir, ".pi");
	const ref = schemaRefFrom(path.join(configDir, "pi-extends.json"));
	const schema = JSON.parse(fs.readFileSync(path.resolve(configDir, ref), "utf8"));
	for (const key of Object.keys(defaultConfig())) {
		if (key === "$schema") continue;
		assert.ok(schema.properties[key] !== undefined, `schema 缺字段 ${key}`);
	}
	fs.rmSync(dir, { recursive: true, force: true });
});
