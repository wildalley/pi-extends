/**
 * 路由角色编辑页。
 *
 * 路由把「用途」映射到模型：写提交信息用便宜模型、攻坚难题用慢模型、
 * 读图用多模态模型。没配的路由沿回退链往后找，最后落回主模型，
 * 所以十条路由全空也能正常工作 —— 配置是渐进的，不是必填的。
 */

import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_ROUTE_FALLBACKS,
	ROUTE_LABELS,
	ROUTE_NAMES,
	resolveRoute,
	type PiExtendsConfig,
	type RouteConfig,
	type RouteName,
	type ThinkingLevel,
} from "./config.ts";
import { THINKING_HINTS, pickModelId, pickThinking, shortModel, thinkingTone } from "./pickers.ts";
import { editConfig } from "./config-ui.ts";
import { getConfig } from "./store.ts";
import { kv, runMenu, sep, type MenuItem } from "./ui-kit.ts";

/** 有多少条路由显式配置了模型或 thinking。 */
export function customizedRouteCount(config: PiExtendsConfig): number {
	return ROUTE_NAMES.filter((r) => {
		const rc = config.routes[r];
		return rc?.model !== undefined || rc?.thinking !== undefined;
	}).length;
}

export function describeRoutes(config: PiExtendsConfig): string {
	return ROUTE_NAMES.map((r) => {
		const resolved = resolveRoute(config, r);
		const from = resolved.route === null ? "主模型" : resolved.route === r ? "自身" : resolved.route;
		return `${r}: ${resolved.model} · thinking ${resolved.thinking} · 来自 ${from}`;
	}).join("\n");
}

function fallbackChain(config: PiExtendsConfig, route: RouteName): RouteName[] {
	return config.routes[route]?.fallback ?? DEFAULT_ROUTE_FALLBACKS[route];
}

function routeValue(config: PiExtendsConfig, route: RouteName): string {
	const rc = config.routes[route];
	if (rc?.model !== undefined) {
		return shortModel(rc.model);
	}
	const resolved = resolveRoute(config, route);
	return resolved.route === null ? "主模型" : `↩ ${resolved.route}`;
}

function routeHint(config: PiExtendsConfig, route: RouteName): string {
	const rc = config.routes[route];
	const parts = [ROUTE_LABELS[route]];
	if (rc?.thinking !== undefined) {
		parts.push(`thinking ${rc.thinking}`);
	}
	if (rc?.model === undefined) {
		const chain = fallbackChain(config, route);
		parts.push(chain.length > 0 ? `回退 ${chain.join(" → ")} → 主模型` : "回退主模型");
	}
	return parts.join("  ·  ");
}

function routeListItems(config: PiExtendsConfig): MenuItem[] {
	return ROUTE_NAMES.map((route, i) => {
		const rc = config.routes[route];
		const custom = rc?.model !== undefined || rc?.thinking !== undefined;
		return {
			id: route,
			group: "路由",
			icon: custom ? "◉" : "○",
			label: route,
			hotkey: i < 9 ? String(i + 1) : "0",
			value: routeValue(config, route),
			tone: custom ? undefined : "muted",
			hint: routeHint(config, route),
			keywords: ROUTE_LABELS[route],
		};
	});
}

function routesStatus(theme: Theme, config: PiExtendsConfig): string[] {
	const custom = customizedRouteCount(config);
	return [
		kv(theme, "◆", "主模型", theme.fg("text", config.currentModel.model)),
		kv(
			theme,
			"◈",
			"已定制",
			theme.fg(custom > 0 ? "success" : "dim", `${custom}/${ROUTE_NAMES.length}`) +
				sep(theme) +
				theme.fg("dim", "未定制的路由沿回退链落到主模型"),
		),
	];
}

/** 路由总览：十条路由一页看全，回车进入单条编辑。 */
export async function routesWizard(ctx: ExtensionCommandContext): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify(describeRoutes(getConfig(ctx.cwd, ctx.isProjectTrusted())), "info");
		return;
	}
	while (true) {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const picked = await runMenu(ctx, {
			title: "路由角色",
			titleRight: `${customizedRouteCount(config)}/${ROUTE_NAMES.length} 已定制`,
			status: (theme) => routesStatus(theme, config),
			items: routeListItems(config),
			reserved: 16,
		});
		if (picked === undefined) {
			return;
		}
		if (isRouteName(picked)) {
			await editRouteWizard(ctx, picked);
		}
	}
}

function isRouteName(v: string): v is RouteName {
	return (ROUTE_NAMES as readonly string[]).includes(v);
}

async function mutateRoute(
	ctx: ExtensionCommandContext,
	route: RouteName,
	mutate: (rc: RouteConfig) => void,
): Promise<void> {
	await editConfig(
		ctx,
		(config) => {
			const rc = config.routes[route] ?? {};
			mutate(rc);
			if (Object.keys(rc).length === 0) {
				delete config.routes[route];
			} else {
				config.routes[route] = rc;
			}
		},
		{ touched: ["routes"] },
	);
}

function editRouteStatus(theme: Theme, config: PiExtendsConfig, route: RouteName): string[] {
	const rc = config.routes[route] ?? {};
	const resolved = resolveRoute(config, route);
	const source =
		rc.model !== undefined
			? ""
			: theme.fg("dim", resolved.route === null ? "  ← 主模型" : `  ← 路由 ${resolved.route}`);
	const chain = fallbackChain(config, route);
	return [
		kv(theme, "▸", "用途", theme.fg("dim", ROUTE_LABELS[route])),
		kv(theme, "◆", "模型", theme.fg("text", resolved.model) + source),
		kv(
			theme,
			"◈",
			"思考",
			theme.fg(thinkingTone(resolved.thinking), resolved.thinking) +
				(rc.thinking ? "" : theme.fg("dim", "  ← 继承")) +
				sep(theme) +
				theme.fg("dim", THINKING_HINTS[resolved.thinking]),
		),
		kv(
			theme,
			"◇",
			"回退",
			chain.length > 0
				? chain.map((c) => theme.fg("text", c)).join(theme.fg("dim", " → ")) +
					theme.fg("dim", " → ") +
					theme.fg("dim", "主模型")
				: theme.fg("dim", "主模型"),
		),
	];
}

function editRouteItems(config: PiExtendsConfig, route: RouteName): MenuItem[] {
	const rc = config.routes[route] ?? {};
	const items: MenuItem[] = [
		{
			id: "model",
			group: "配置",
			icon: "◆",
			label: "模型",
			hotkey: "1",
			value: rc.model ? shortModel(rc.model) : "未设置",
			tone: rc.model ? undefined : "muted",
			hint: rc.model ? "已定制" : "沿回退链解析",
		},
		{
			id: "thinking",
			group: "配置",
			icon: "◈",
			label: "thinking level",
			hotkey: "2",
			value: rc.thinking ?? "继承",
			tone: rc.thinking ? thinkingTone(rc.thinking) : "muted",
			hint: rc.thinking ? "已定制" : "继承回退链上第一个显式配置",
		},
	];
	if (rc.model !== undefined) {
		items.push({ id: "clear-model", group: "重置", icon: "×", label: "清除模型", hotkey: "3", tone: "muted" });
	}
	if (rc.thinking !== undefined) {
		items.push({ id: "clear-thinking", group: "重置", icon: "×", label: "清除 thinking", hotkey: "4", tone: "muted" });
	}
	if (rc.model !== undefined || rc.thinking !== undefined || rc.fallback !== undefined) {
		items.push({ id: "reset", group: "重置", icon: "○", label: "整条路由恢复默认", hotkey: "0", tone: "muted" });
	}
	return items;
}

async function editRouteWizard(ctx: ExtensionCommandContext, route: RouteName): Promise<void> {
	while (true) {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const rc = config.routes[route] ?? {};
		const picked = await runMenu(ctx, {
			title: `路由 ${route}`,
			titleRight: rc.model !== undefined || rc.thinking !== undefined ? "已定制" : "全部回退",
			status: (theme) => editRouteStatus(theme, config, route),
			items: editRouteItems(config, route),
			reserved: 18,
		});
		if (picked === undefined) {
			return;
		}
		await applyRouteAction(ctx, route, picked, config);
	}
}

async function applyRouteAction(
	ctx: ExtensionCommandContext,
	route: RouteName,
	action: string,
	config: PiExtendsConfig,
): Promise<void> {
	if (action === "model") {
		const id = await pickModelId(ctx, `路由 ${route} 的模型`, resolveRoute(config, route).model);
		if (id !== undefined) {
			await mutateRoute(ctx, route, (rc) => {
				rc.model = id;
			});
			ctx.ui.notify(`路由 ${route} 的模型已设为 ${id}。`, "info");
		}
		return;
	}
	if (action === "thinking") {
		const picked = await pickThinking(ctx, `路由 ${route} 的 thinking`, resolveRoute(config, route).thinking, {
			inheritLabel: "继承回退链",
		});
		if (picked === undefined) {
			return;
		}
		if (picked === "__inherit") {
			await mutateRoute(ctx, route, (rc) => {
				delete rc.thinking;
			});
			ctx.ui.notify(`路由 ${route} 的 thinking 改为继承。`, "info");
			return;
		}
		const level: ThinkingLevel = picked;
		await mutateRoute(ctx, route, (rc) => {
			rc.thinking = level;
		});
		ctx.ui.notify(`路由 ${route} 的 thinking 已设为 ${level}。`, "info");
		return;
	}
	if (action === "clear-model") {
		await mutateRoute(ctx, route, (rc) => {
			delete rc.model;
		});
		ctx.ui.notify(`路由 ${route} 的模型已清除，改为沿回退链解析。`, "info");
		return;
	}
	if (action === "clear-thinking") {
		await mutateRoute(ctx, route, (rc) => {
			delete rc.thinking;
		});
		ctx.ui.notify(`路由 ${route} 的 thinking 已清除。`, "info");
		return;
	}
	if (action === "reset") {
		await editConfig(
			ctx,
			(config) => {
				delete config.routes[route];
			},
			{ touched: ["routes"], notify: `路由 ${route} 已恢复默认。` },
		);
	}
}
