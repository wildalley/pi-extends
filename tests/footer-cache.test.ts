import { test } from "node:test";
import assert from "node:assert/strict";
import {
	formatCacheHit,
	NO_CACHE_WARN_INPUT,
	NO_CACHE_WARN_TURNS,
} from "../extensions/pi-extends/footer.ts";

const base = { input: 0, turns: 0, cacheRead: 0, cacheWrite: 0 };

test("有缓存命中时显示命中率，且不是告警", () => {
	const view = formatCacheHit({ ...base, input: 1000, turns: 5, cacheRead: 9000, lastCacheHit: 90 });
	assert.equal(view?.text, "CH90.0%");
	assert.equal(view?.warn, false);
});

test("有 cacheWrite 但还没算出命中率时不占位", () => {
	assert.equal(formatCacheHit({ ...base, input: 1000, turns: 5, cacheWrite: 2000 }), undefined);
});

test("会话刚开始、量还小的时候不告警", () => {
	assert.equal(formatCacheHit({ ...base, input: 10_000, turns: 1 }), undefined);
});

// 一次贴进来一个大文件也能超过阈值，但那不是链路故障，不该标红。
test("轮数不够时不告警，哪怕输入量已经很大", () => {
	assert.equal(
		formatCacheHit({ ...base, input: NO_CACHE_WARN_INPUT * 3, turns: NO_CACHE_WARN_TURNS - 1 }),
		undefined,
	);
});

test("多轮全价重发且零命中时告警", () => {
	const view = formatCacheHit({ ...base, input: NO_CACHE_WARN_INPUT, turns: NO_CACHE_WARN_TURNS });
	assert.equal(view?.text, "CH0%");
	assert.equal(view?.warn, true);
});

// 这是最贵的那种故障：不显示等于「一切正常」，所以零命中必须显示出来。
test("零命中的告警优先于「没有缓存段就不显示」的老行为", () => {
	const quiet = formatCacheHit({ ...base, input: NO_CACHE_WARN_INPUT, turns: NO_CACHE_WARN_TURNS });
	assert.notEqual(quiet, undefined);
});
