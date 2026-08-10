import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_ROUTE_FALLBACKS,
	type PiExtendsConfig,
	type RouteName,
	type ThinkingLevel,
} from "./config.ts";

export type RuntimeRouteSource = RouteName | "current" | "active";
export type RouteAttemptStatus = "selected" | "unregistered" | "unauthenticated" | "incompatible";

export interface RuntimeRouteAttempt {
	model: string;
	source: RuntimeRouteSource;
	status: RouteAttemptStatus;
	reason?: string;
}

export interface RuntimeRouteResolution {
	requested: RouteName;
	model?: Model<any>;
	modelId?: string;
	source?: RuntimeRouteSource;
	thinking: ThinkingLevel;
	attempts: RuntimeRouteAttempt[];
}

export interface RouteModelInventory {
	all: readonly Model<any>[];
	available: readonly Model<any>[];
	active?: Model<any>;
}

/**
 * 从 Pi 当前上下文读取路由解析所需的三份事实：注册目录、已认证模型和当前活动模型。
 *
 * `getAvailable()` 是 Pi 已经做过认证可用性筛选的快照；把它和 `getAll()` 分开传给
 * 解析器，才能把「没注册」与「已注册但未认证」显示成两种不同诊断。活动模型单独保留
 * 为最后一道保底：它可能来自会话恢复，尚未出现在当前 registry 快照里。
 */
export function inventoryFromContext(
	ctx: Pick<ExtensionContext, "modelRegistry" | "model">,
): RouteModelInventory {
	return {
		all: ctx.modelRegistry.getAll(),
		available: ctx.modelRegistry.getAvailable(),
		active: ctx.model,
	};
}

export interface RuntimeRouteOptions {
	require?: (model: Model<any>) => boolean;
	requireLabel?: string;
}

interface Candidate {
	model: string;
	source: RuntimeRouteSource;
}

export function fullModelId(model: Pick<Model<any>, "provider" | "id">): string {
	return `${model.provider}/${model.id}`;
}

function routeCandidates(
	config: PiExtendsConfig,
	route: RouteName,
): { candidates: Candidate[]; thinking: ThinkingLevel } {
	const queue: RouteName[] = [route];
	const seenRoutes = new Set<RouteName>();
	const seenModels = new Set<string>();
	const candidates: Candidate[] = [];
	let thinking: ThinkingLevel | undefined;
	while (queue.length > 0) {
		const name = queue.shift() as RouteName;
		if (seenRoutes.has(name)) continue;
		seenRoutes.add(name);
		const entry = config.routes[name];
		if (thinking === undefined && entry?.thinking !== undefined) {
			thinking = entry.thinking;
		}
		if (entry?.model && !seenModels.has(entry.model)) {
			seenModels.add(entry.model);
			candidates.push({ model: entry.model, source: name });
		}
		queue.push(...(entry?.fallback ?? DEFAULT_ROUTE_FALLBACKS[name]));
	}
	if (!seenModels.has(config.currentModel.model)) {
		seenModels.add(config.currentModel.model);
		candidates.push({ model: config.currentModel.model, source: "current" });
	}
	return { candidates, thinking: thinking ?? config.currentModel.thinking };
}

/**
 * 将静态路由配置落实到当前 registry。不可用的候选不会截断回退链；最终还会尝试
 * 当前活动模型，以保证配置过期时主流程仍有保底，并把每次跳过的原因留给 UI。
 */
export function resolveRuntimeRoute(
	config: PiExtendsConfig,
	route: RouteName,
	inventory: RouteModelInventory,
	options: RuntimeRouteOptions = {},
): RuntimeRouteResolution {
	const { candidates, thinking } = routeCandidates(config, route);
	const activeId = inventory.active ? fullModelId(inventory.active) : undefined;
	if (activeId && !candidates.some((candidate) => candidate.model === activeId)) {
		candidates.push({ model: activeId, source: "active" });
	}
	const all = new Map(inventory.all.map((model) => [fullModelId(model), model]));
	const available = new Set(inventory.available.map(fullModelId));
	if (activeId) available.add(activeId);
	const attempts: RuntimeRouteAttempt[] = [];

	for (const candidate of candidates) {
		const model = all.get(candidate.model) ??
			(inventory.active && fullModelId(inventory.active) === candidate.model ? inventory.active : undefined);
		if (!model) {
			attempts.push({ ...candidate, status: "unregistered" });
			continue;
		}
		if (!available.has(candidate.model)) {
			attempts.push({ ...candidate, status: "unauthenticated" });
			continue;
		}
		if (options.require && !options.require(model)) {
			attempts.push({
				...candidate,
				status: "incompatible",
				...(options.requireLabel ? { reason: options.requireLabel } : {}),
			});
			continue;
		}
		attempts.push({ ...candidate, status: "selected" });
		return {
			requested: route,
			model,
			modelId: candidate.model,
			source: candidate.source,
			thinking,
			attempts,
		};
	}

	return { requested: route, thinking, attempts };
}

const ATTEMPT_LABELS: Record<Exclude<RouteAttemptStatus, "selected">, string> = {
	unregistered: "未注册",
	unauthenticated: "未认证",
	incompatible: "能力不匹配",
};

export function formatRouteDiagnostics(resolution: RuntimeRouteResolution): string {
	const skipped = resolution.attempts.filter((attempt) => attempt.status !== "selected");
	if (skipped.length === 0) return "";
	return skipped.map((attempt) => {
		const status = ATTEMPT_LABELS[attempt.status as Exclude<RouteAttemptStatus, "selected">];
		return `${attempt.model}（${status}${attempt.reason ? `: ${attempt.reason}` : ""}）`;
	}).join("、");
}
