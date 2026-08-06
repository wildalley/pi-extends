import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	THINKING_LEVELS,
	type PiExtendsConfig,
	type RoleName,
	type ThinkingLevel,
} from "./config.ts";
import {
	THINKING_HINTS,
	pickModelId,
	pickThinking,
	pickToolSet,
	readonlyToolSet,
	shortModel,
	thinkingTone,
} from "./pickers.ts";
import { editConfig } from "./config-ui.ts";
import { getConfig } from "./store.ts";
import { kv, runMenu, sep, type MenuItem } from "./ui-kit.ts";

export function describeRole(config: PiExtendsConfig, role: RoleName): string {
	const rc = config.roles[role];
	const model = rc?.model ?? config.currentModel.model;
	const thinking = rc?.thinking ?? config.currentModel.thinking;
	const tools = rc?.tools?.join(", ") ?? roleToolDefault(role).join(", ");
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

export function resolveRoleModel(config: PiExtendsConfig, role: RoleName): string {
	return config.roles[role]?.model ?? config.currentModel.model;
}

export function resolveRoleThinking(
	config: PiExtendsConfig,
	role: RoleName,
): (typeof THINKING_LEVELS)[number] {
	return config.roles[role]?.thinking ?? config.currentModel.thinking;
}

export function resolveRoleTools(config: PiExtendsConfig, role: RoleName): string[] {
	return config.roles[role]?.tools ?? roleToolDefault(role);
}

const WRITE_TOOLS = new Set(["bash", "edit", "write"]);

async function mutateRole(
	ctx: ExtensionCommandContext,
	role: RoleName,
	mutate: (rc: NonNullable<PiExtendsConfig["roles"][RoleName]>) => void,
): Promise<void> {
	await editConfig(
		ctx,
		(config) => {
			const rc = config.roles[role] ?? {};
			mutate(rc);
			config.roles[role] = rc;
		},
		{ touched: ["roles"] },
	);
}

function roleStatus(theme: Theme, config: PiExtendsConfig, role: RoleName): string[] {
	const rc = config.roles[role] ?? {};
	const thinking = resolveRoleThinking(config, role);
	const inherited = theme.fg("dim", "  继承");
	const tools = resolveRoleTools(config, role)
		.map((t) => theme.fg(WRITE_TOOLS.has(t) ? "warning" : "text", t))
		.join(sep(theme, false));
	return [
		kv(
			theme,
			"◆",
			"模型",
			theme.fg("text", resolveRoleModel(config, role)) + (rc.model ? "" : inherited),
		),
		kv(
			theme,
			"◈",
			"思考",
			theme.fg(thinkingTone(thinking), thinking) +
				(rc.thinking ? "" : inherited) +
				sep(theme) +
				theme.fg("dim", THINKING_HINTS[thinking]),
		),
		kv(theme, "◇", "工具", tools + (rc.tools ? "" : inherited)),
	];
}

function roleItems(config: PiExtendsConfig, role: RoleName): MenuItem[] {
	const rc = config.roles[role] ?? {};
	const thinking = resolveRoleThinking(config, role);
	const tools = resolveRoleTools(config, role);
	const items: MenuItem[] = [
		{
			id: "model",
			group: "配置",
			icon: "◆",
			label: "模型",
			hotkey: "1",
			value: shortModel(resolveRoleModel(config, role)),
			hint: rc.model ? "已定制" : "继承主模型",
		},
		{
			id: "thinking",
			group: "配置",
			icon: "◈",
			label: "thinking level",
			hotkey: "2",
			value: thinking,
			tone: thinkingTone(thinking),
			hint: rc.thinking ? "已定制" : "继承主模型",
		},
		{
			id: "tools",
			group: "配置",
			icon: "◇",
			label: "工具权限",
			hotkey: "3",
			value: `${tools.length} 个`,
			hint: tools.join(" "),
		},
		{
			id: "readonly",
			group: "配置",
			icon: "▸",
			label: "限为只读工具",
			hotkey: "4",
			hint: readonlyToolSet().join(" "),
		},
	];
	if (rc.model !== undefined) {
		items.push({ id: "clear-model", group: "重置", icon: "×", label: "清除模型定制", hotkey: "5", tone: "muted" });
	}
	if (rc.thinking !== undefined) {
		items.push({ id: "clear-thinking", group: "重置", icon: "×", label: "清除 thinking 定制", hotkey: "6", tone: "muted" });
	}
	if (rc.tools !== undefined) {
		items.push({ id: "clear-tools", group: "重置", icon: "×", label: "清除工具定制", hotkey: "7", tone: "muted" });
	}
	items.push({ id: "reset", group: "重置", icon: "○", label: "整个角色恢复默认", hotkey: "0", tone: "muted" });
	return items;
}

export async function editRoleWizard(
	ctx: ExtensionCommandContext,
	role: RoleName,
): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify(describeRole(getConfig(ctx.cwd, ctx.isProjectTrusted()), role), "info");
		return;
	}
	while (true) {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const rc = config.roles[role] ?? {};
		const customized =
			rc.model !== undefined || rc.thinking !== undefined || rc.tools !== undefined;
		const picked = await runMenu(ctx, {
			title: `角色 ${role}`,
			titleRight: customized ? "已定制" : "全部继承默认",
			status: (theme) => roleStatus(theme, config, role),
			items: roleItems(config, role),
			reserved: 16,
		});
		if (picked === undefined) {
			return;
		}
		await applyRoleAction(ctx, role, picked, config);
	}
}

async function applyRoleAction(
	ctx: ExtensionCommandContext,
	role: RoleName,
	action: string,
	config: PiExtendsConfig,
): Promise<void> {
	if (action === "model") {
		const id = await pickModelId(ctx, `${role} 的模型`, resolveRoleModel(config, role));
		if (id !== undefined) {
			await mutateRole(ctx, role, (rc) => {
				rc.model = id;
			});
			ctx.ui.notify(`角色 ${role} 的模型已设为 ${id}。`, "info");
		}
		return;
	}
	if (action === "thinking") {
		const picked = await pickThinking(ctx, `${role} 的 thinking`, resolveRoleThinking(config, role), {
			inheritLabel: "继承主模型",
		});
		if (picked === undefined) {
			return;
		}
		if (picked === "__inherit") {
			await mutateRole(ctx, role, (rc) => {
				delete rc.thinking;
			});
			ctx.ui.notify(`角色 ${role} 的 thinking 改为继承主模型。`, "info");
			return;
		}
		const level: ThinkingLevel = picked;
		await mutateRole(ctx, role, (rc) => {
			rc.thinking = level;
		});
		ctx.ui.notify(`角色 ${role} 的 thinking 已设为 ${level}。`, "info");
		return;
	}
	if (action === "tools") {
		const tools = await pickToolSet(ctx, `${role} 的工具权限`, resolveRoleTools(config, role));
		if (tools !== undefined) {
			await mutateRole(ctx, role, (rc) => {
				rc.tools = tools;
			});
			ctx.ui.notify(`角色 ${role} 的工具已保存：${tools.join(" ") || "无"}。`, "info");
		}
		return;
	}
	await applyRoleReset(ctx, role, action);
}

async function applyRoleReset(
	ctx: ExtensionCommandContext,
	role: RoleName,
	action: string,
): Promise<void> {
	if (action === "readonly") {
		const tools = readonlyToolSet();
		await mutateRole(ctx, role, (rc) => {
			rc.tools = tools;
		});
		ctx.ui.notify(`角色 ${role} 的工具已限为只读：${tools.join(" ")}。`, "info");
		return;
	}
	if (action === "clear-model") {
		await mutateRole(ctx, role, (rc) => {
			delete rc.model;
		});
		ctx.ui.notify(`角色 ${role} 的模型改为继承主模型。`, "info");
		return;
	}
	if (action === "clear-thinking") {
		await mutateRole(ctx, role, (rc) => {
			delete rc.thinking;
		});
		ctx.ui.notify(`角色 ${role} 的 thinking 改为继承主模型。`, "info");
		return;
	}
	if (action === "clear-tools") {
		await mutateRole(ctx, role, (rc) => {
			delete rc.tools;
		});
		ctx.ui.notify(`角色 ${role} 的工具改为默认。`, "info");
		return;
	}
	if (action === "reset") {
		await editConfig(
			ctx,
			(config) => {
				delete config.roles[role];
			},
			{ touched: ["roles"] },
		);
		ctx.ui.notify(`角色 ${role} 已恢复默认。`, "info");
	}
}
