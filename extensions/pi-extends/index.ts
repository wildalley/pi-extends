import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { atomicWriteJson, resolveConfigPaths, sanitizeConfig, schemaRefFrom } from "./config.ts";
import { registerAdvisor } from "./advisor.ts";
import { openCockpit } from "./cockpit.ts";
import registerFooter from "./footer.ts";
import goalModeExtension from "./goal-mode.ts";
import { registerKeywords } from "./keywords.ts";
import { registerOrchestration } from "./orchestration.ts";
import planModeExtension from "./plan-mode.ts";
import { reapplyCustomProviders } from "./providers.ts";
import { setAPI } from "./runtime.ts";
import { getConfig, reload } from "./store.ts";
import { registerSubagentTool } from "./subagents.ts";

export const EXAMPLE_PATH = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"templates",
	"pi-extends.example.json",
);

async function cmdConfig(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const paths = resolveConfigPaths(ctx.cwd);
	const action = args.trim();
	if (action === "status") {
		const { config, warnings } = reload(ctx.cwd, ctx.isProjectTrusted());
		ctx.ui.notify(
			`配置: ${paths.projectPath}\n主题: ${config.theme} · 模型: ${config.currentModel.model}`,
			"info",
		);
		for (const w of warnings) {
			ctx.ui.notify(w, "warning");
		}
		return;
	}
	if (action === "generate") {
		const example = JSON.parse(fs.readFileSync(EXAMPLE_PATH, "utf8"));
		example.$schema = schemaRefFrom(paths.projectPath);
		await atomicWriteJson(paths.projectPath, example);
		reload(ctx.cwd, ctx.isProjectTrusted());
		ctx.ui.notify(`已写入 ${paths.projectPath}`, "info");
		return;
	}
	if (action === "validate") {
		const { config, warnings } = reload(ctx.cwd, ctx.isProjectTrusted());
		const clean = sanitizeConfig(config);
		const total = warnings.length + clean.warnings.length;
		ctx.ui.notify(
			total === 0 ? "配置有效" : `配置有 ${total} 条警告`,
			total === 0 ? "info" : "warning",
		);
		return;
	}
	ctx.ui.notify("用法: /config [status|generate|validate]", "info");
}

async function cmdCockpit(args: string, ctx: ExtensionCommandContext): Promise<void> {
	await openCockpit(ctx);
}

async function cmdRoles(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const { roleMenu } = await import("./cockpit.ts");
	await roleMenu(ctx);
}

async function cmdAgents(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const { runSubagentLauncher } = await import("./subagents.ts");
	await runSubagentLauncher(ctx, args);
}

async function cmdAdvisor(args: string, ctx: ExtensionCommandContext): Promise<void> {
	const action = args.trim().toLowerCase();
	const { advisorController, setAdvisorEnabled } = await import("./advisor.ts");
	if (action === "on" || action === "off") {
		await setAdvisorEnabled(ctx, action === "on");
		ctx.ui.notify(`Advisor 旁审 ${action}。`, "info");
		return;
	}
	if (action !== "") {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		ctx.ui.notify(
			`用法: /advisor [on|off]（当前 ${advisorController.isEnabled(config) ? "on" : "off"}）`,
			"info",
		);
		return;
	}
	const { openAdvisorMenu } = await import("./cockpit.ts");
	await openAdvisorMenu(ctx);
}

export default async function (pi: ExtensionAPI): Promise<void> {
	setAPI(pi);

	registerSubagentTool(pi);
	planModeExtension(pi);
	goalModeExtension(pi);
	registerFooter(pi);
	registerAdvisor(pi);
	registerKeywords(pi);
	// 注册在 keywords 之后：两者都改写同一条输入，而自动分工要先看到关键词有没有命中。
	registerOrchestration(pi);

	pi.registerCommand("cockpit", {
		description: "打开 Pi Extends 主控制台",
		handler: cmdCockpit,
	});
	pi.registerCommand("theme", {
		description: "切换主题：/theme [名称]，不带参数打开选择器",
		handler: async (args, ctx) => {
			const { runThemeCommand } = await import("./cockpit.ts");
			await runThemeCommand(ctx, args);
		},
	});
	pi.registerCommand("roles", {
		description: "配置四个角色的模型、thinking 和工具权限",
		handler: cmdRoles,
	});
	pi.registerCommand("routes", {
		description: "按用途给模型分工：default/smol/slow/plan/commit/vision/designer/task/advisor/tiny",
		handler: async (_args, ctx) => {
			const { routesWizard } = await import("./routes.ts");
			await routesWizard(ctx);
		},
	});
	pi.registerCommand("advisor", {
		description: "Advisor 旁审：/advisor [on|off]，不带参数打开设置",
		handler: cmdAdvisor,
	});
	pi.registerCommand("agents", {
		description: "运行单个、并行或串行子代理",
		handler: cmdAgents,
	});
	pi.registerCommand("config", {
		description: "pi-extends 配置：status 查看、generate 生成示例、validate 校验",
		handler: cmdConfig,
	});

	pi.on("session_start", (event, ctx) => {
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		const themeResult = ctx.ui.setTheme(config.theme);
		if (!themeResult.success && config.theme !== "pi-carbon") {
			ctx.ui.notify(`应用主题 "${config.theme}" 失败: ${themeResult.error ?? "未知错误"}`, "warning");
		}
		const errors = reapplyCustomProviders(ctx, config);
		for (const error of errors) {
			ctx.ui.notify(`自定义厂商注册失败: ${error}`, "error");
		}
	});
}
