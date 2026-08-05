import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	BUILTIN_TOOLS,
	THINKING_LEVELS,
	isValidThinkingLevel,
	type PiExtendsConfig,
	type RoleConfig,
	type RoleName,
} from "./config.ts";
import { updateConfig } from "./store.ts";

export function describeRole(
	config: PiExtendsConfig,
	role: RoleName,
): string {
	const rc = config.roles[role];
	const model = rc?.model ?? config.currentModel.model;
	const thinking = rc?.thinking ?? config.currentModel.thinking;
	const tools = rc?.tools?.join(", ") ?? "继承默认";
	return `${role}: ${model} · thinking ${thinking} · 工具 [${tools}]`;
}

export function roleToolDefault(role: RoleName): string[] {
	switch (role) {
		case "scout":
		case "planner":
		case "reviewer":
			return ["read", "grep", "find", "ls"];
		case "worker":
			return ["read", "bash", "edit", "write"];
	}
}

export function resolveRoleModel(
	config: PiExtendsConfig,
	role: RoleName,
): string {
	return config.roles[role]?.model ?? config.currentModel.model;
}

export function resolveRoleThinking(
	config: PiExtendsConfig,
	role: RoleName,
): typeof THINKING_LEVELS[number] {
	return config.roles[role]?.thinking ?? config.currentModel.thinking;
}

export function resolveRoleTools(
	config: PiExtendsConfig,
	role: RoleName,
): string[] {
	return config.roles[role]?.tools ?? roleToolDefault(role);
}

function modelOptions(
	ctx: ExtensionCommandContext,
	showAll: boolean,
): string[] {
	const models = ctx.modelRegistry.getAll();
	const list = models
		.filter((m) => showAll || ctx.modelRegistry.hasConfiguredAuth(m))
		.map((m) => `${m.provider}/${m.id}`)
		.sort();
	return Array.from(new Set(list));
}

export async function editRoleWizard(
	ctx: ExtensionCommandContext,
	role: RoleName,
): Promise<void> {
	const config = await getConfigForEdit(ctx);
	const current = describeRole(config, role);
	const action = await ctx.ui.select(`角色 ${role} 配置\n当前：${current}`, [
		"设置模型",
		"设置 thinking level",
		"设置工具权限",
		"恢复默认",
	]);
	if (action === undefined) {
		return;
	}

	if (action === "设置模型") {
		await pickRoleModel(ctx, role);
		return;
	}
	if (action === "设置 thinking level") {
		await pickRoleThinking(ctx, role);
		return;
	}
	if (action === "设置工具权限") {
		await pickRoleTools(ctx, role);
		return;
	}
	if (action === "恢复默认") {
		await updateConfig(ctx.cwd, ctx.isProjectTrusted(), (config) => {
			delete config.roles[role];
		});
		ctx.ui.notify(`角色 ${role} 已恢复默认。`, "info");
		return;
	}
}

async function getConfigForEdit(ctx: ExtensionCommandContext): Promise<PiExtendsConfig> {
	const { getConfig } = await import("./store.ts");
	return getConfig(ctx.cwd, ctx.isProjectTrusted());
}

async function pickRoleModel(
	ctx: ExtensionCommandContext,
	role: RoleName,
): Promise<void> {
	let showAll = false;
	while (true) {
		const options = modelOptions(ctx, showAll);
		const header = showAll ? "全部模型" : "已认证模型（显示全部模型 查看所有）";
		const labels = [...options, showAll ? "仅显示已认证模型" : "显示全部模型", "取消"];
		const picked = await ctx.ui.select(`选择 ${role} 的模型（${header}）`, labels, {
			timeout: 60000,
		});
		if (picked === undefined || picked === "取消") {
			return;
		}
		if (picked === "显示全部模型" || picked === "仅显示已认证模型") {
			showAll = !showAll;
			continue;
		}
		await updateConfig(ctx.cwd, ctx.isProjectTrusted(), (config) => {
			if (!config.roles[role]) {
				config.roles[role] = {};
			}
			config.roles[role].model = picked;
		});
		ctx.ui.notify(`角色 ${role} 的模型已设为 ${picked}。`, "info");
		return;
	}
}

async function pickRoleThinking(
	ctx: ExtensionCommandContext,
	role: RoleName,
): Promise<void> {
	const picked = await ctx.ui.select(`选择 ${role} 的 thinking level`, [
		...THINKING_LEVELS,
		"取消",
	]);
	if (picked === undefined || picked === "取消" || !isValidThinkingLevel(picked)) {
		return;
	}
	await updateConfig(ctx.cwd, ctx.isProjectTrusted(), (config) => {
		if (!config.roles[role]) {
			config.roles[role] = {};
		}
		config.roles[role].thinking = picked;
	});
	ctx.ui.notify(`角色 ${role} 的 thinking 已设为 ${picked}。`, "info");
}

async function pickRoleTools(
	ctx: ExtensionCommandContext,
	role: RoleName,
): Promise<void> {
	const config = await getConfigForEdit(ctx);
	const current = new Set(resolveRoleTools(config, role));
	while (true) {
		const labels = BUILTIN_TOOLS.map((t) =>
			current.has(t) ? `✓ ${t}` : `  ${t}`,
		);
		const header = `角色 ${role} 工具权限（当前：${Array.from(current).join(", ") || "无"}）`;
		const action = await ctx.ui.select(header, [
			`完成并保存（${Array.from(current).join(", ")}）`,
			...labels,
			"仅保留只读工具",
			"取消",
		]);
		if (action === undefined || action === "取消") {
			return;
		}
		if (action === "仅保留只读工具") {
			current.clear();
			for (const t of ["read", "grep", "find", "ls"]) {
				current.add(t);
			}
			await saveTools(ctx, role, current);
			ctx.ui.notify(`角色 ${role} 工具已限为只读。`, "info");
			return;
		}
		if (action.startsWith("完成并保存")) {
			await saveTools(ctx, role, current);
			ctx.ui.notify(`角色 ${role} 工具已保存。`, "info");
			return;
		}
		const tool = action.trim().replace(/^✓\s*/, "");
		if (current.has(tool)) {
			current.delete(tool);
		} else {
			current.add(tool);
		}
	}
}

async function saveTools(
	ctx: ExtensionCommandContext,
	role: RoleName,
	tools: Set<string>,
): Promise<void> {
	await updateConfig(ctx.cwd, ctx.isProjectTrusted(), (config) => {
		if (!config.roles[role]) {
			config.roles[role] = {};
		}
		config.roles[role].tools = Array.from(tools);
	});
}
