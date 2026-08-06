/**
 * 写回分层语义的回归测试。
 *
 * 这两条锁住 code review 里发现的高危问题：
 * - 用户级配置被整份抄进项目级文件（隐私 + 让用户级此后失效）
 * - 未信任的项目仍然被写入
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { reload, updateConfig } from "../extensions/pi-extends/store.ts";

/**
 * store 用 resolveConfigPaths(cwd) 定位用户级文件，后者读 HOME。
 * 因此把 HOME 指到临时目录就能完整隔离一次测试。
 */
async function withSandbox(
	fn: (dirs: { home: string; project: string }) => Promise<void>,
): Promise<void> {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-extends-store-"));
	const home = path.join(root, "home");
	const project = path.join(root, "project");
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(project, { recursive: true });
	const prevHome = process.env.HOME;
	const prevProfile = process.env.USERPROFILE;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	try {
		await fn({ home, project });
	} finally {
		if (prevHome === undefined) delete process.env.HOME;
		else process.env.HOME = prevHome;
		if (prevProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = prevProfile;
		fs.rmSync(root, { recursive: true, force: true });
	}
}

function writeJson(filePath: string, data: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function readJson(filePath: string): any {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test("默认写用户级，不把用户配置抄进项目文件", async () => {
	await withSandbox(async ({ home, project }) => {
		const userPath = path.join(home, ".pi", "agent", "pi-extends.json");
		const projectPath = path.join(project, ".pi", "pi-extends.json");
		writeJson(userPath, {
			version: 1,
			currentModel: { model: "openai/gpt-5.2", thinking: "max" },
		});
		writeJson(projectPath, { version: 1, theme: "pi-paper" });
		reload(project, true);

		const result = await updateConfig(project, true, (config) => {
			config.theme = "pi-sakura";
		});

		// 改动落在用户级。
		assert.equal(result.path, userPath);
		assert.equal(readJson(userPath).theme, "pi-sakura");
		// 项目级文件完全没被碰过 —— 这是原来的泄漏点。
		assert.deepEqual(readJson(projectPath), { version: 1, theme: "pi-paper" });
		// 用户级文件里没有出现项目级的值。
		assert.notEqual(readJson(userPath).theme, "pi-paper");
		// 项目级仍然压着 theme，用户会收到提示。
		assert.deepEqual(result.shadowed, ["theme"]);
	});
});

test("未信任的项目拒绝写入项目级", async () => {
	await withSandbox(async ({ project }) => {
		reload(project, false);
		await assert.rejects(
			() => updateConfig(project, false, (c) => { c.theme = "pi-carbon"; }, { scope: "project" }),
			/未被信任/,
		);
		assert.equal(fs.existsSync(path.join(project, ".pi", "pi-extends.json")), false);
	});
});

test("清除路由模型后写盘不再被默认值复活", async () => {
	await withSandbox(async ({ home, project }) => {
		const userPath = path.join(home, ".pi", "agent", "pi-extends.json");
		writeJson(userPath, {
			version: 1,
			routes: { smol: { model: "google/gemini-2.5-flash", thinking: "low" } },
		});
		reload(project, true);

		await updateConfig(project, true, (config) => {
			delete config.routes.smol?.model;
		});

		const written = readJson(userPath);
		assert.equal(written.routes.smol.model, undefined);
		assert.equal(written.routes.smol.thinking, "low");
		// 重新加载后依然是清除状态。
		const after = reload(project, true).config;
		assert.equal(after.routes.smol?.model, undefined);
	});
});

test("写盘失败不污染内存缓存", async () => {
	await withSandbox(async ({ project }) => {
		reload(project, true);
		await assert.rejects(() =>
			updateConfig(project, true, () => {
				throw new Error("mutate 失败");
			}),
		);
		// 缓存仍然可用且是干净的。
		const config = reload(project, true).config;
		assert.equal(typeof config.theme, "string");
	});
});
