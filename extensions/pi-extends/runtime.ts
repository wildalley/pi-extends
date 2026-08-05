import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

let api: ExtensionAPI | undefined;

export function setAPI(a: ExtensionAPI): void {
	api = a;
}

export function getAPI(): ExtensionAPI {
	if (!api) {
		throw new Error("ExtensionAPI 尚未初始化");
	}
	return api;
}
