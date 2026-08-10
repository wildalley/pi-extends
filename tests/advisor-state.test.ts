import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { advisorController, registerAdvisor } from "../extensions/pi-extends/advisor.ts";
import type { PiExtendsConfig } from "../extensions/pi-extends/config.ts";

function makeAdvisorPi(): { pi: ExtensionAPI; emitSessionStart: () => Promise<void> } {
	const handlers: Array<() => void> = [];
	const pi = {
		registerMessageRenderer: () => {},
		on: (event: string, handler: () => void) => {
			if (event === "session_start") handlers.push(handler);
		},
	} as unknown as ExtensionAPI;
	return {
		pi,
		emitSessionStart: async () => {
			for (const handler of handlers) handler();
		},
	};
}

const disabledConfig = { advisor: { enabled: false } } as PiExtendsConfig;

test("session_start 清除 Advisor 的临时开关", async () => {
	const h = makeAdvisorPi();
	registerAdvisor(h.pi);

	advisorController.setEnabled(true);
	assert.equal(advisorController.isEnabled(disabledConfig), true);
	await h.emitSessionStart();
	assert.equal(advisorController.isEnabled(disabledConfig), false);

	// 下一次会话仍然从配置读取，而不会继承上一会话的 on。
	advisorController.setEnabled(true);
	await h.emitSessionStart();
	assert.equal(advisorController.isEnabled(disabledConfig), false);
});
