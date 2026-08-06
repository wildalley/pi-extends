/**
 * 配置缓存与写回。
 *
 * 分层语义：默认空基线 → 用户级（~/.pi/agent/pi-extends.json）→ 项目级（<cwd>/.pi/pi-extends.json）。
 * 读取时逐层覆盖；写回时只写一层，且用 `exact` 模式校验，这样 delete 才能真正落盘。
 *
 * 默认写用户级。原因：cockpit 里改的是「我的偏好」（主题、主模型、路由分工），
 * 不是「这个仓库的约定」。写项目级会把个人配置抄进别人会提交的文件里，
 * 也会让项目文件变成全量快照、此后压掉用户级的任何修改。
 */

import * as fs from "node:fs";
import {
	applyPatch,
	atomicWriteJson,
	diffConfig,
	emptyBase,
	loadConfigFiles,
	resolveConfigPaths,
	sanitizeConfig,
	type ConfigLoadResult,
	type ConfigScope,
	type PiExtendsConfig,
} from "./config.ts";
import { setIconSet } from "./icons.ts";
import { setBorderStyle } from "./ui-kit.ts";

/** 读目标层现有文档；不存在或坏了都当空文档，避免写回时丢掉整层。 */
function readRawOrEmpty(filePath: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf8"));
	} catch {
		return {};
	}
}

interface StoreState extends ConfigLoadResult {
	cwd: string;
	trusted: boolean;
	userRaw: unknown;
	projectKeys: string[];
}

let state: StoreState | undefined;

export function ensureLoaded(cwd: string, trusted: boolean): ConfigLoadResult {
	if (state && state.cwd === cwd && state.trusted === trusted) {
		return state;
	}
	const paths = resolveConfigPaths(cwd);
	const result = loadConfigFiles({
		userPath: paths.userPath,
		projectPath: trusted ? paths.projectPath : undefined,
	});
	state = {
		config: result.config,
		warnings: result.warnings,
		userRaw: result.userRaw,
		projectKeys: result.projectKeys,
		cwd,
		trusted,
	};
	// 图标集和边框样式都是渲染期读的模块级状态（见 icons.ts 的 `active`、
	// ui-kit.ts 的 `activeBorder`），必须在配置生效的同一时刻同步过去。
	// 放在这里而不是各个界面里：加载与重载都只走这一个入口，
	// 漏一处就会出现「配置改了但某个页面还是旧样式」。
	setIconSet(result.config.icons);
	setBorderStyle(result.config.border);
	return result;
}

export function reload(cwd: string, trusted: boolean): ConfigLoadResult {
	state = undefined;
	return ensureLoaded(cwd, trusted);
}

export function getConfig(cwd: string, trusted: boolean): PiExtendsConfig {
	return ensureLoaded(cwd, trusted).config;
}

/** 项目级配置覆盖了哪些顶层键 —— 用户级改这些键不会立即生效，需要提示。 */
export function shadowedKeys(cwd: string, trusted: boolean): string[] {
	ensureLoaded(cwd, trusted);
	return state?.projectKeys ?? [];
}

export interface UpdateOptions {
	/** 写哪一层，默认用户级。 */
	scope?: ConfigScope;
}

export interface UpdateResult {
	config: PiExtendsConfig;
	/** 实际写入的文件路径。 */
	path: string;
	/** 本次修改涉及但被项目级覆盖的顶层键。 */
	shadowed: string[];
	warnings: string[];
}

/**
 * 修改并写回配置。
 *
 * `mutate` 收到的是完整的合并后配置（所有调用点都依赖这一点，例如
 * `config.routes[route] ?? {}`)。写回时按目标层重新计算：
 * 用户级 → 以空基线为准，得到的就是纯用户级文档；
 * 项目级 → 需要显式传 scope，且未信任时拒绝写入。
 */
export async function updateConfig(
	cwd: string,
	trusted: boolean,
	mutate: (config: PiExtendsConfig) => void | Promise<void>,
	opts: UpdateOptions = {},
): Promise<UpdateResult> {
	const scope = opts.scope ?? "user";
	const paths = resolveConfigPaths(cwd);
	const targetPath = scope === "user" ? paths.userPath : paths.projectPath;

	if (scope === "project" && !trusted) {
		throw new Error("项目未被信任，拒绝写入项目级配置。");
	}

	// 在副本上修改：写盘失败时内存状态不受污染。
	const current = getConfig(cwd, trusted);
	const draft = structuredClone(current) as PiExtendsConfig;
	await mutate(draft);

	// 只取「这次真正改了什么」，避免把其他层的值抄进目标层。
	const patch = diffConfig(current, draft);
	const targetRaw =
		scope === "user" ? (state?.userRaw ?? {}) : readRawOrEmpty(targetPath);
	const merged = applyPatch(targetRaw, patch);

	// exact 模式：只保留文档里真实存在的字段，不从默认值回填，
	// 于是 `delete rc.model` 这类清除操作能真正写进文件。
	const cleaned = sanitizeConfig(merged, emptyBase(), "exact");
	await atomicWriteJson(targetPath, cleaned.config);

	// 只报「这次改到的键里，哪些被项目级压着」——报全部项目级键会变成噪音。
	const projectKeys = state?.projectKeys ?? [];
	const touched =
		typeof patch === "object" && patch !== null && !Array.isArray(patch)
			? Object.keys(patch)
			: [];
	const shadowed =
		scope === "user" ? touched.filter((k) => projectKeys.includes(k)) : [];

	reload(cwd, trusted);

	return {
		config: state?.config ?? cleaned.config,
		path: targetPath,
		shadowed,
		warnings: cleaned.warnings,
	};
}
