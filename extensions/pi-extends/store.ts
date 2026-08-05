import {
	atomicWriteJson,
	loadConfigFiles,
	resolveConfigPaths,
	sanitizeConfig,
	type ConfigLoadResult,
	type PiExtendsConfig,
} from "./config.ts";

interface StoreState extends ConfigLoadResult {
	cwd: string;
	trusted: boolean;
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
	state = { ...result, cwd, trusted };
	return result;
}

export function reload(cwd: string, trusted: boolean): ConfigLoadResult {
	state = undefined;
	return ensureLoaded(cwd, trusted);
}

export function getConfig(cwd: string, trusted: boolean): PiExtendsConfig {
	return ensureLoaded(cwd, trusted).config;
}

export async function updateConfig(
	cwd: string,
	trusted: boolean,
	mutate: (config: PiExtendsConfig) => void | Promise<void>,
): Promise<PiExtendsConfig> {
	const current = getConfig(cwd, trusted);
	await mutate(current);
	const cleaned = sanitizeConfig(current);
	await atomicWriteJson(resolveConfigPaths(cwd).projectPath, cleaned.config);
	state = {
		...cleaned,
		cwd,
		trusted,
	};
	return cleaned.config;
}
