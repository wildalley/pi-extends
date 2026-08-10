import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { generateExampleConfig, resolveConfigPaths, sanitizeConfig } from "./config.ts";
import { registerAdvisor } from "./advisor.ts";
import { registerAutoVisionRouting } from "./auto-vision.ts";
import { cacheDiagnosticsPage } from "./cache-diagnostics.ts";
import {
	AGENT_STATUS_KEY,
	getAgentStatus,
	resetAgentStatus,
} from "./agent-status.ts";
import { openCockpit } from "./cockpit.ts";
import registerFooter from "./footer.ts";
import goalModeExtension from "./goal-mode.ts";
import { registerKeywords } from "./keywords.ts";
import { formatDuration, sendNotification, shouldNotifyIdle } from "./notify.ts";
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
		const result = await generateExampleConfig(ctx.cwd, ctx.isProjectTrusted());
		if (!result.ok) {
			ctx.ui.notify(
				result.reason === "untrusted"
					? `项目未信任，拒绝写入 ${result.path}。先执行 /trust 再生成。`
					: `${result.path} 已存在，未覆盖。需要显式使用 /config generate --force。`,
				"warning",
			);
			return;
		}
		reload(ctx.cwd, ctx.isProjectTrusted());
		ctx.ui.notify(`已写入 ${result.path}`, "info");
		return;
	}
	if (action === "generate --force") {
		const result = await generateExampleConfig(ctx.cwd, ctx.isProjectTrusted(), { force: true });
		if (!result.ok) {
			ctx.ui.notify(
				result.reason === "untrusted"
					? `项目未信任，拒绝写入 ${result.path}。先执行 /trust 再生成。`
					: `无法生成配置：${result.path} 已存在且未能覆盖。`,
				"warning",
			);
			return;
		}
		reload(ctx.cwd, ctx.isProjectTrusted());
		ctx.ui.notify(`已强制写入 ${result.path}`, "info");
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

/**
 * 桌面通知 + footer 子代理计数的生命周期。
 *
 * 计时用 agent_start→agent_settled：agent_end 会在自动重试/压缩之间触发多次，
 * 按它计时会把一次长任务算成好几段。settled 才是「真的停下来等人」。
 *
 * 子代理计数刻意不在 settled 时清零 —— 回答刚出来的那几秒正是用户会去看
 * 「刚才派了几个」的时候。下一轮 agent_start 再归零。
 */
function registerNotifications(pi: ExtensionAPI): void {
	let startedAt: number | undefined;

	pi.on("agent_start", (_event, ctx) => {
		startedAt = Date.now();
		if (getAgentStatus().launched > 0) {
			resetAgentStatus();
			ctx.ui.setStatus(AGENT_STATUS_KEY, undefined);
		}
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const began = startedAt;
		startedAt = undefined;
		if (began === undefined) {
			return;
		}
		const elapsed = Date.now() - began;
		const config = getConfig(ctx.cwd, ctx.isProjectTrusted());
		if (!shouldNotifyIdle(elapsed, config.notifications)) {
			return;
		}
		const agents = getAgentStatus();
		const suffix = agents.launched > 0 ? ` · ${agents.launched} 个子代理` : "";
		await sendNotification(pi, {
			title: `pi · ${path.basename(ctx.cwd) || ctx.cwd}`,
			body: `回合完成 · ${formatDuration(elapsed)}${suffix}`,
		});
	});
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
	registerAutoVisionRouting(pi);
	registerNotifications(pi);

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
	pi.registerCommand("cache", {
		description: "诊断当前分支最近回合的缓存提示、指标与命中率",
		handler: async (_args, ctx) => {
			await cacheDiagnosticsPage(ctx);
		},
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
