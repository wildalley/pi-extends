import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import {
	THINKING_LEVELS,
	isValidThinkingLevel,
	type PiExtendsConfig,
	type RoleName,
} from "./config.ts";
import { addProviderWizard, providerStatusPage, removeProviderWizard } from "./providers.ts";
import { describeRole, editRoleWizard } from "./roles.ts";
import { getAPI } from "./runtime.ts";
import { getConfig, updateConfig } from "./store.ts";

function modelIdOf(m: Model<any>): string {
	return `${m.provider}/${m.id}`;
}

function findModelById(
	ctx: ExtensionCommandContext,
	id: string,
): Model<any> | undefined {
	return ctx.modelRegistry.getAll().find((m) => modelIdOf(m) === id);
}

export function dashboardLines(
	ctx: ExtensionCommandContext,
	config: PiExtendsConfig,
): string[] {
	const goal = config.goal;
	return [
		`主题: ${config.theme}`,
		`主模型: ${config.currentModel.model} · thinking ${config.currentModel.thinking}`,
		...(["scout", "planner", "worker", "reviewer"] as RoleName[]).map((r) =>
			describeRole(config, r),
		),
		`Goal: ${goal.defaultMode} · 最多自动推进 ${goal.maxAutoTurns} 轮`,
		`Plan: 未启用（/plan on）`,
		`自定义厂商: ${config.providers.length} 个`,
	];
}

export async function showDashboard(
	ctx: ExtensionCommandContext,
): Promise<void> {
	const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
	ctx.ui.setStatus("cockpit", "Pi Extends 控制台");
	const text = dashboardLines(ctx, config).join("\n");
	await ctx.ui.select("Pi Extends 控制台（Esc 关闭）", [text]);
	ctx.ui.setStatus("cockpit", undefined);
}

export async function openCockpit(
	ctx: ExtensionCommandContext,
): Promise<void> {
	while (true) {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const menu = [
			"1. Theme：切换主题",
			"2. Current model：主模型与 thinking",
			"3. Role models：角色模型与工具权限",
			"4. Providers：厂商认证与自定义厂商",
			"5. Subagents：子代理（single/parallel/chain）",
			"6. Goal mode：目标模式",
			"7. Plan mode：计划模式",
			"8. Config：配置管理",
			"9. 状态总览",
		];
		const picked = await ctx.ui.select(
			`Pi Extends 控制台\n主题 ${config.theme} · 模型 ${config.currentModel.model}`,
			menu,
			{ timeout: 120000 },
		);
		if (picked === undefined) {
			return;
		}
		if (picked.startsWith("1.")) {
			await themeWizard(ctx);
		} else if (picked.startsWith("2.")) {
			await currentModelWizard(ctx);
		} else if (picked.startsWith("3.")) {
			await roleMenu(ctx);
		} else if (picked.startsWith("4.")) {
			await providersMenu(ctx);
		} else if (picked.startsWith("5.")) {
			ctx.ui.notify("使用 subagent 工具：single（role+task）、parallel（tasks）、chain（{previous}）。", "info");
		} else if (picked.startsWith("6.")) {
			const { runGoalCommand } = await import("./goal-mode.ts");
			const action = await ctx.ui.select("Goal 模式（Esc 返回）", [
				"start",
				"status",
				"pause",
				"resume",
				"complete",
				"clear",
			]);
			if (action === undefined) {
				continue;
			}
			const api = getAPI();
			if (action === "start") {
				const text = await ctx.ui.input("目标文本（追加 --autopilot 启用自动推进）", "");
				if (text === undefined) {
					continue;
				}
				await runGoalCommand(api, ctx, `start ${text}`);
			} else if (action === "complete") {
				const summary = (await ctx.ui.input("完成摘要", "")) ?? "";
				await runGoalCommand(api, ctx, `complete ${summary}`);
			} else {
				await runGoalCommand(api, ctx, action);
			}
		} else if (picked.startsWith("7.")) {
			const { planController } = await import("./plan-mode.ts");
			const action = await ctx.ui.select("Plan 模式（Esc 返回）", [
				"/plan on",
				"/plan off",
				"/plan status",
				"/plan execute",
			]);
			if (action === undefined) {
				continue;
			}
			const verb = action.replace("/plan ", "");
			if (verb === "on") {
				planController.enable?.(ctx);
			} else if (verb === "off") {
				planController.disable?.(ctx);
			} else if (verb === "status") {
				planController.status?.(ctx);
			} else if (verb === "execute") {
				planController.execute?.(ctx);
			}
		} else if (picked.startsWith("8.")) {
			await configMenu(ctx);
		} else if (picked.startsWith("9.")) {
			await showDashboard(ctx);
		}
	}
}

export async function applyTheme(
	ctx: ExtensionCommandContext,
	name: string,
): Promise<boolean> {
	const result = ctx.ui.setTheme(name);
	if (!result.success) {
		ctx.ui.notify(`切换主题失败: ${result.error ?? "未知错误"}`, "error");
		return false;
	}
	await updateConfig(ctx.cwd, ctx.isProjectTrusted(), (config) => {
		config.theme = name;
	});
	ctx.ui.notify(`主题已切换为 ${name}。`, "info");
	return true;
}

async function themeWizard(ctx: ExtensionCommandContext): Promise<void> {
	while (true) {
		const picked = await pickTheme(ctx);
		if (picked === undefined) {
			return;
		}
		if (await applyTheme(ctx, picked)) {
			return;
		}
	}
}

export async function pickTheme(ctx: ExtensionCommandContext): Promise<string | undefined> {
	const themes = ctx.ui.getAllThemes().map((t) => t.name);
	const options = [...new Set(["dark", "light", ...themes])].sort();
	return ctx.ui.select("选择主题（立即生效，Esc 返回）", options, { timeout: 60000 });
}

export async function runThemeCommand(
	ctx: ExtensionCommandContext,
	args: string,
): Promise<void> {
	const name = args.trim();
	if (name) {
		await applyTheme(ctx, name);
		return;
	}
	const picked = await pickTheme(ctx);
	if (picked !== undefined) {
		await applyTheme(ctx, picked);
	}
}

async function currentModelWizard(ctx: ExtensionCommandContext): Promise<void> {
	const picked = await pickModel(ctx, "主模型");
	if (picked === undefined) {
		return;
	}
	const model = findModelById(ctx, picked);
	if (model) {
		const ok = await getAPI().setModel(model);
		if (!ok) {
			ctx.ui.notify("切换模型失败：可能缺少 API Key。", "warning");
		}
	}
	const thinking = await ctx.ui.select("thinking level", [...THINKING_LEVELS, "取消"]);
	if (thinking === undefined || thinking === "取消" || !isValidThinkingLevel(thinking)) {
		await updateConfig(ctx.cwd, ctx.isProjectTrusted(), (config) => {
			config.currentModel.model = picked;
		});
		ctx.ui.notify(`主模型已设为 ${picked}。`, "info");
		return;
	}
	getAPI().setThinkingLevel(thinking);
	await updateConfig(ctx.cwd, ctx.isProjectTrusted(), (config) => {
		config.currentModel.model = picked;
		config.currentModel.thinking = thinking;
	});
	ctx.ui.notify(`主模型 ${picked} · thinking ${thinking}。`, "info");
}

async function pickModel(
	ctx: ExtensionCommandContext,
	label: string,
): Promise<string | undefined> {
	let showAll = false;
	while (true) {
		const models = ctx.modelRegistry.getAll();
		const list = models
			.filter((m) => showAll || ctx.modelRegistry.hasConfiguredAuth(m))
			.map(modelIdOf)
			.sort();
		const options = Array.from(new Set(list));
		const toggle = showAll ? "仅显示已认证模型" : "显示全部模型";
		const picked = await ctx.ui.select(
			`${label}（${showAll ? "全部" : "已认证"}）`,
			[...options, toggle, "取消"],
			{ timeout: 60000 },
		);
		if (picked === undefined || picked === "取消") {
			return undefined;
		}
		if (picked === "显示全部模型" || picked === "仅显示已认证模型") {
			showAll = !showAll;
			continue;
		}
		return picked;
	}
}

export async function roleMenu(ctx: ExtensionCommandContext): Promise<void> {
	const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
	const options = (["scout", "planner", "worker", "reviewer"] as RoleName[]).map(
		(r) => describeRole(config, r),
	);
	const picked = await ctx.ui.select("选择角色（Esc 返回）", options, {
		timeout: 60000,
	});
	if (picked === undefined) {
		return;
	}
	const role = options.indexOf(picked);
	const names = ["scout", "planner", "worker", "reviewer"] as RoleName[];
	if (role < 0) {
		return;
	}
	await editRoleWizard(ctx, names[role] as RoleName);
}

async function providersMenu(ctx: ExtensionCommandContext): Promise<void> {
	const action = await ctx.ui.select("厂商管理（Esc 返回）", [
		"查看认证状态",
		"添加自定义厂商",
		"移除自定义厂商",
	]);
	if (action === undefined) {
		return;
	}
	if (action === "查看认证状态") {
		await providerStatusPage(ctx);
	} else if (action === "添加自定义厂商") {
		await addProviderWizard(ctx);
	} else if (action === "移除自定义厂商") {
		await removeProviderWizard(ctx);
	}
}

async function configMenu(ctx: ExtensionCommandContext): Promise<void> {
	const action = await ctx.ui.select("配置管理（Esc 返回）", [
		"校验配置",
		"重新加载配置",
		"写入示例配置到 .pi/pi-extends.json",
	]);
	if (action === undefined) {
		return;
	}
	const { reload } = await import("./store.ts");
	const { atomicWriteJson, resolveConfigPaths, sanitizeConfig } = await import("./config.ts");
	if (action === "校验配置") {
		const result = reload(ctx.cwd, ctx.isProjectTrusted());
		const warnings = result.warnings;
		ctx.ui.notify(
			warnings.length === 0
				? "配置有效。"
				: `配置有 ${warnings.length} 条警告：${warnings.slice(0, 3).join("；")}`,
			warnings.length === 0 ? "info" : "warning",
		);
		return;
	}
	if (action === "重新加载配置") {
		const result = reload(ctx.cwd, ctx.isProjectTrusted());
		ctx.ui.notify(
			result.warnings.length === 0
				? "配置已重新加载。"
				: `配置已加载，但有警告：${result.warnings.slice(0, 3).join("；")}`,
			result.warnings.length === 0 ? "info" : "warning",
		);
		return;
	}
	if (action === "写入示例配置到 .pi/pi-extends.json") {
		const { EXAMPLE_PATH } = await import("./index.ts");
		const example = JSON.parse(await import("node:fs").then((fs) => fs.readFileSync(EXAMPLE_PATH, "utf8")));
		const paths = resolveConfigPaths(ctx.cwd);
		await atomicWriteJson(paths.projectPath, example);
		reload(ctx.cwd, ctx.isProjectTrusted());
		ctx.ui.notify(`示例配置已写入 ${paths.projectPath}。`, "info");
		return;
	}
}
