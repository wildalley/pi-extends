# 第三方声明（Third-Party Notices）

本包的部分代码源自 MIT 许可证的 Pi 官方仓库
[`earendil-works/pi`](https://github.com/earendil-works/pi)，已标注于
`PLAN.md` 第 12 节。以下是具体来源、许可证与改动范围。

## 1. plan-mode 示例

- **来源**: `examples/extensions/plan-mode/`（`index.ts`、`utils.ts`）
- **许可证**: MIT
- **改动范围**:
  - `plan-utils.ts`：移植 `utils.ts`（只读命令 allowlist/denylist、`Plan:` 步骤提取、`[DONE:n]` 完成标记）。将步骤文本长度阈值从 `>5` 调整为 `>=3` 以兼容较短中文步骤。
  - `plan-mode.ts`：移植 `index.ts`，新增 `/plan on|off|status|execute` 子命令、`planController` 供 Cockpit 与 Goal 模式联动、`isPlanModeActive()/isPlanExecuting()` 访问器。

## 2. subagent 示例

- **来源**: `examples/extensions/subagent/index.ts`
- **许可证**: MIT
- **改动范围**:
  - `subagents.ts`：将基于 markdown 文件的 agent 发现改为基于本项目角色的配置模型（scout/planner/worker/reviewer），保留 single/parallel/chain 三种执行方式、JSONL 流式解析、并发限制、中止传播与输出截断。
  - `subagent-parse.ts`：将 JSONL 解析与输出截断提取为纯函数模块。
  - 新增 Plan 模式联动：Plan 模式下禁止启动具有写权限的 worker 子代理。

## 3. preset.ts / todo.ts

- **来源**: `examples/extensions/preset.ts`、`examples/extensions/todo.ts`
- **许可证**: MIT
- **改动范围**: 仅作为 API 使用参考，未直接复制代码。

## 4. pi-cometix-footer

- **来源**: https://github.com/Xichun123/pi-cometix-footer（MIT，Xichun123）
- **许可证**: MIT
- **改动范围**:
  - `footer.ts`：二开单行 cometix 风格 footer。改为颜色跟随当前主题（`theme.fg`）而非硬编码 16 色 SGR；图标默认使用 emoji 模式；命令更名为 `/footer`（支持 `tps` 子命令）。
  - `duration.ts`、`tps.ts` 逻辑内联进 `footer.ts`。
  - 视觉风格源自 CCometixLine（MIT, Haleclipse），见上游 README。

## 5. pi-sakura-cyberdeck / pi-switch / pi-packages

- **来源**: https://github.com/beautifulrem/pi-sakura-cyberdeck（MIT）、https://github.com/CallmeLins/pi-switch（MIT）、https://github.com/NekoSekaiMoe/pi-packages
- **许可证**: MIT
- **改动范围**: 未直接复制代码；参考其「特色主题/header/footer」的设计思路，新增 `pi-sakura`（马卡龙樱色）与 `pi-terminal`（荧光绿 CRT）两个原创主题。

## 依赖

- 运行时仅依赖 Pi 提供的 peer packages：`@earendil-works/pi-ai`、
  `@earendil-works/pi-agent-core`、`@earendil-works/pi-coding-agent`、
  `@earendil-works/pi-tui`、`typebox`。

本包采用 MIT 许可证，详见根目录 LICENSE 信息。
