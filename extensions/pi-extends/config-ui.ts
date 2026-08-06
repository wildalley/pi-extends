/**
 * 配置写回的统一入口（带 UI 反馈）。
 *
 * 所有编辑界面都该走这里，而不是直接调 store.updateConfig ——
 * 这样「项目级覆盖了你刚改的键」这类提示只需要写一次。
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ConfigScope, PiExtendsConfig } from "./config.ts";
import { updateConfig } from "./store.ts";

/** 顶层键 → 中文名，用于覆盖提示。 */
const KEY_LABELS: Record<string, string> = {
	theme: "主题",
	currentModel: "主模型",
	roles: "角色",
	routes: "路由",
	providers: "厂商",
	subagents: "子代理上限",
	goal: "Goal",
	advisor: "Advisor",
	keywords: "魔法关键词",
	orchestration: "自动分工",
};

export interface EditOptions {
	scope?: ConfigScope;
	/** 本次改动涉及的顶层键，用于精确判断是否被项目级覆盖。 */
	touched?: string[];
	/** 成功后的提示；不传则不提示。 */
	notify?: string;
}

/**
 * 修改配置并给出反馈。默认写用户级。
 * 若改动的键正被项目级配置覆盖，额外提示一条 warning —— 否则用户会以为设置没生效。
 */
export async function editConfig(
	ctx: ExtensionContext,
	mutate: (config: PiExtendsConfig) => void | Promise<void>,
	opts: EditOptions = {},
): Promise<PiExtendsConfig> {
	const result = await updateConfig(ctx.cwd, ctx.isProjectTrusted(), mutate, {
		scope: opts.scope,
	});

	if (opts.notify) {
		ctx.ui.notify(opts.notify, "info");
	}

	const touched = opts.touched;
	const conflicts = touched
		? result.shadowed.filter((k) => touched.includes(k))
		: result.shadowed;
	if (conflicts.length > 0) {
		const names = conflicts.map((k) => KEY_LABELS[k] ?? k).join("、");
		ctx.ui.notify(
			`已写入用户级配置，但项目配置 .pi/pi-extends.json 也定义了「${names}」，会覆盖这里的设置。`,
			"warning",
		);
	}
	for (const w of result.warnings) {
		ctx.ui.notify(w, "warning");
	}
	return result.config;
}
