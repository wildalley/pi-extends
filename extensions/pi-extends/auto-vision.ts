import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import {
	resolveRoute,
	type PiExtendsConfig,
	type ResolvedRoute,
	type ThinkingLevel,
} from "./config.ts";
import { findMagicKeywords } from "./keywords.ts";
import { getConfig } from "./store.ts";

export interface VisionRouteResolution {
	route: ResolvedRoute;
	model?: Model<any>;
}

interface RestoreState {
	previousModel: Model<any>;
	previousThinking?: ThinkingLevel;
	switchedModel: Model<any>;
}

export function modelId(model: Pick<Model<any>, "provider" | "id">): string {
	return `${model.provider}/${model.id}`;
}

export function supportsImages(model: Pick<Model<any>, "input"> | undefined): boolean {
	return model?.input.includes("image") ?? false;
}

export function resolveVisionModel(
	config: PiExtendsConfig,
	models: readonly Model<any>[],
): VisionRouteResolution {
	const route = resolveRoute(config, "vision");
	return {
		route,
		model: models.find((candidate) => modelId(candidate) === route.model),
	};
}

function notifyUnavailable(ctx: ExtensionContext, route: ResolvedRoute, reason: string): void {
	ctx.ui.notify(`自动视觉路由不可用：${reason}（vision → ${route.model}）`, "warning");
}

/**
 * 图片输入时临时切到 vision 路由；回合完全结束后恢复切换前的模型。
 *
 * 这只处理用户输入中已经附带的图片。工具在后续返回的图片仍由当前模型
 * 的自身 input 能力决定，避免在一次正在运行的请求中途切模型。
 */
export function registerAutoVisionRouting(pi: ExtensionAPI): void {
	let restore: RestoreState | undefined;

	pi.on("input", async (event, ctx) => {
		if (!event.images || event.images.length === 0 || event.streamingBehavior !== undefined) {
			return { action: "continue" };
		}

		const current = ctx.model;
		if (!current || supportsImages(current) || restore !== undefined) {
			return { action: "continue" };
		}

		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const resolved = resolveVisionModel(config, ctx.modelRegistry.getAll());
		if (!resolved.model) {
			notifyUnavailable(ctx, resolved.route, "模型未注册");
			return { action: "continue" };
		}
		if (!supportsImages(resolved.model)) {
			notifyUnavailable(ctx, resolved.route, "模型不支持 image 输入");
			return { action: "continue" };
		}

		// ultrathink 已经由 keywords handler 临时提升并负责恢复；此时自动视觉
		// 路由只切模型，不能再接管 thinking 的恢复顺序。
		const ultrathinkActive =
			config.keywords.enabled && findMagicKeywords(event.text).includes("ultrathink");
		const previousThinking = ultrathinkActive ? undefined : pi.getThinkingLevel();
		const switched = await pi.setModel(resolved.model);
		if (!switched) {
			notifyUnavailable(ctx, resolved.route, "模型认证不可用");
			return { action: "continue" };
		}

		restore = {
			previousModel: current,
			previousThinking,
			switchedModel: resolved.model,
		};
		if (previousThinking !== undefined) {
			pi.setThinkingLevel(resolved.route.thinking);
		}
		ctx.ui.notify(`图片输入：临时切换到 vision → ${modelId(resolved.model)}`, "info");
		return { action: "continue" };
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const pending = restore;
		restore = undefined;
		if (!pending) {
			return;
		}

		// 如果用户在回合结束前手动选了另一个模型，不要把它覆盖回旧模型。
		if (ctx.model && modelId(ctx.model) !== modelId(pending.switchedModel)) {
			ctx.ui.notify("视觉路由结束：检测到模型已被手动切换，跳过自动恢复。", "info");
			return;
		}

		const restored = await pi.setModel(pending.previousModel);
		if (!restored) {
			ctx.ui.notify(`视觉路由恢复失败，当前仍是 ${modelId(pending.switchedModel)}。`, "warning");
			return;
		}
		if (pending.previousThinking !== undefined) {
			pi.setThinkingLevel(pending.previousThinking);
		}
		ctx.ui.notify(`视觉路由结束：已恢复 ${modelId(pending.previousModel)}`, "info");
	});
}
