import { test } from "node:test";
import assert from "node:assert/strict";
import {
	cleanStepText,
	extractDoneSteps,
	extractTodoItems,
	isSafeCommand,
	markCompletedSteps,
} from "../extensions/pi-extends/plan-utils.ts";

test("只读命令被允许", () => {
	for (const cmd of [
		"cat src/a.ts",
		"grep -r foo .",
		"ls -la",
		"git status",
		"git log --oneline",
		"npm list",
		"find . -name '*.ts'",
		"sed -n '1,10p' file.txt",
		"rg pattern src",
		"echo hello",
		"pwd",
	]) {
		assert.equal(isSafeCommand(cmd), true, cmd);
	}
});

test("有副作用命令被拦截", () => {
	for (const cmd of [
		"rm -rf dist",
		"rm file.txt",
		"mv a b",
		"cp a b",
		"mkdir foo",
		"touch file",
		"chmod +x run.sh",
		"git add .",
		"git commit -m x",
		"git push",
		"npm install lodash",
		"pip install x",
		"sudo apt update",
		"kill -9 123",
		"cat a > out.txt",
		"echo hi >> log",
		"tee out.txt",
		"vim main.ts",
	]) {
		assert.equal(isSafeCommand(cmd), false, cmd);
	}
});

test("未知命令不被允许（既非安全列表也非破坏列表）", () => {
	assert.equal(isSafeCommand("somescript.sh"), false);
	assert.equal(isSafeCommand("python run.py"), false);
});

test("extractTodoItems 提取 Plan 标题下的编号步骤", () => {
	const message = `前言说明

Plan:
1. 定位认证模块
2. 重构 OAuth 流程
3. 添加测试

总结`;
	const items = extractTodoItems(message);
	assert.equal(items.length, 3);
	assert.equal(items[0].text, "定位认证模块");
	assert.equal(items[1].text, "重构 OAuth 流程");
	assert.equal(items[2].text, "添加测试");
	assert.ok(items.every((t) => t.completed === false));
});

test("extractTodoItems 无 Plan 标题返回空", () => {
	assert.equal(extractTodoItems("没有计划的普通回答").length, 0);
});

test("extractTodoItems 支持数字与括号编号", () => {
	const items = extractTodoItems("Plan:\n1) aaa\n2) bbb\n3. ccc");
	assert.equal(items.length, 3);
});

test("markCompletedSteps 根据 [DONE:n] 标记完成", () => {
	const items = extractTodoItems("Plan:\n1. 步骤甲\n2. 步骤乙\n3. 步骤丙");
	assert.equal(items.length, 3);
	const done = markCompletedSteps("完成步骤一 [DONE:1]\n完成步骤三 [DONE:3]", items);
	assert.equal(done, 2);
	assert.equal(items[0].completed, true);
	assert.equal(items[1].completed, false);
	assert.equal(items[2].completed, true);
});

test("extractDoneSteps 提取所有 [DONE:n]", () => {
	assert.deepEqual(extractDoneSteps("a [DONE:2] b [DONE:5]"), [2, 5]);
});

test("cleanStepText 清理格式并去除动词前缀", () => {
	assert.equal(cleanStepText("**Rewrite the README**"), "Rewrite the README");
	assert.equal(cleanStepText("`npm run build`"), "Npm run build");
	assert.equal(cleanStepText("Add new endpoint"), "New endpoint");
});
