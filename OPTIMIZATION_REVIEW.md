# Pi Extends 优化审查报告

> 审查日期：2026-02（基于 `extensions/` 全部源码、`tests/` 147 个测试与工具脚本）
>
> 结论先行：代码质量高于一般扩展项目 —— 分层配置 + diff 补丁写回、plan 模式三道安全关卡、
> footer 按需拉取 git 状态、测试全绿。真正值得动的点集中在**测试缺口**与**边缘情况**，
> 按价值排序见文末「实施优先级」。

## 1. 总评

| 维度 | 结论 |
| --- | --- |
| 安全模型 | plan 模式三道关卡（元字符拒绝 → 破坏性命令拒绝 → 允许清单 + 危险参数兜底），设计严谨 |
| 配置系统 | 用户级/项目级分层、diff 补丁防反向泄漏、原子写入带 fsync，实现扎实 |
| 性能 | git 状态按 TTL + in-flight 防重入按需拉取，空闲不 fork 子进程；并发子代理有上限 |
| 可维护性 | 注释详尽且解释「为什么」；私有区码位用 `\uXXXX` 转义防静默损坏 |
| 测试 | 147 个测试全绿，纯函数（icons/plan-utils/keywords/mouse/routes）覆盖良好 |

## 2. 测试覆盖缺口（最高价值）

### 2.1 plan-mode 状态机无直接测试

- **文件**：`extensions/pi-extends/plan-mode.ts`（安全关键模块）
- **现状**：`tests/plan-safety.test.ts` 只覆盖 `plan-utils.ts` 的纯函数（`isSafeCommand` 等），
  plan-mode 自身的状态机（enable/disable/execute 的权限切换、`[DONE:n]` 完成标记、agent_end 收尾判定）
  完全依赖手测。
- **风险**：工具禁用/恢复逻辑出错是「静默放行写操作」级别的问题，属于出事代价最高的类别。
- **建议新增用例**：
  1. `enable()` 后 `setActiveTools` 收到只读清单（无 `edit`/`write`，含 `read`/`grep` 等）
  2. `disable()` / `startExecution()` 后恢复全量工具
  3. `turn_end` 收到 `[DONE:2]` 后仅第 2 步标记完成
  4. `agent_end` 全部完成才清空执行态并结束，部分完成不清空
  5. plan 模式下 `bash` 工具调用：允许清单内放行、`rm`/管道/重定向被 `block`

### 2.2 goal-mode 状态机无测试

- **文件**：`extensions/pi-extends/goal-mode.ts`
- **风险**：轮次上限（`maxTurns`）与 active→paused→blocked→resume 状态迁移是自动推进的
  安全边界，同样「出错代价高」。
- **建议新增用例**：状态迁移合法性、超轮次拒绝、autopilot 注入内容包含目标/进度/轮次。

### 2.3 便宜的纯函数缺口

- `pi-child.ts`（子进程参数构造）、`pickers.ts`（`modelIdOf`/`modelHint`）是纯函数，测试成本低。

## 3. plan-mode session 恢复的真实边缘 bug

- **位置**：`plan-mode.ts` `session_start` 恢复执行段
- **问题**：`executeIndex` 从 entries 尾部找 `plan-mode-execute` entry；
  若该 entry 被 **compaction 丢弃**（大会话压缩后完全可能），`executeIndex` 保持 `-1`，
  恢复循环会从 `entries[0]` 开始把**整个会话**的 assistant 消息拼起来跑 `markCompletedSteps`，
  旧消息里若有 `[DONE:n]` 字样即误标已完成，恢复后直接跳步。
- **修复建议**：`executeIndex < 0` 时跳过恢复标记（宁可从头执行，不可误标）：
  ```ts
  if (isResume && executionMode && todoItems.length > 0 && executeIndex >= 0) { ... }
  ```
- **严重度**：低（需 compaction + 含 DONE 标记的旧消息同时出现才触发），但修复成本极低。

> **更正（复核后）**：结论对，归因错。compaction 不会丢 entry —— SessionManager 只**追加**
> 一条带 `firstKeptEntryId` 的 `compaction` entry，`getEntries()` 返回的是整个文件；
> 会裁掉割点之前内容的是 `buildContextEntries()` / `buildSessionContext()`，恢复逻辑没用它们。
> 真正能让 `executeIndex` 停在 `-1` 的是另外两条路：一是 `deliverAs: "followUp"` 排队期间
> 进程退出（`plan-mode` entry 已落盘、`plan-mode-execute` 消息还没），二是 rewind 之后
> `.pop()` 捡到别的分支。闸门照建议加了，另外把恢复的取数换成 `getBranch()`（见下）。

## 4. cockpit.ts wizard 模式重复

- **文件**：`extensions/pi-extends/cockpit.ts`（1720 行，项目最大文件）
- **现状**：`themeWizard` / `borderWizard` / `iconWizard` 结构完全同构：
  构造 radio items → `runMenu` → `onHighlight` 即时预览 → Esc 恢复原值 → `editConfig` 落盘。
- **建议**：提取泛型 `radioWizard(ctx, { title, items, onHighlight, apply, revert })`，
  三个页面各留 ~20 行差异逻辑。
- **收益**：中等（可维护性，非缺陷；现有重复已克制）。

## 5. 小项

| 项目 | 位置 | 说明 |
| --- | --- | --- |
| `any` 清理 | `subagents.ts:537,561` | `theme: any` 可换成 `Theme`（`Model<any>` 来自 pi API，合理，不动） |
| verify-icons 一键化 | `tools/verify-icons.mjs` + `fetch-icon-tables.mjs` | 核对脚本依赖 `/tmp` 手工 curl 的上游表；加 npm script 把 fetch → verify 串起来，降低「改了图标表忘了核对」概率 |
| git status 大仓库 | `footer.ts` `refreshGit` | 3s timeout + in-flight 防重入已兜底；超大仓库可考虑失败时降级为只显示分支名 |

## 6. 设计取舍（非缺陷，值得讨论）

1. **默认图标集 `lucide`**：新用户装完必现豆腐块（README 有说明，但无运行时提示）。
   可选方案：`session_start` 时提示一次「图标集为 lucide，若显示豆腐块请 /cockpit → 图标集」。
   终端内检测 PUA 字形成本高，低成本替代是首次运行提示。
2. **工作区未提交**：`package.json` / `package-lock.json` 有未提交改动
   （上次加 `lucide-static` devDependency），建议先提交，避免混进下次改动。

## 7. 实施优先级

| 优先级 | 事项 | 成本 | 理由 |
| --- | --- | --- | --- |
| P0 | §3 plan-mode 恢复误标修复 | ~10 分钟 | 真实 bug，修复便宜 |
| P1 | §2.1 plan-mode 状态机测试 | ~1 小时 | 安全关键逻辑防回归 |
| P1 | §2.2 goal-mode 状态机测试 | ~30 分钟 | 轮次上限是安全边界 |
| P2 | §4 wizard 提取 | ~1 小时 | 可维护性 |
| P2 | §5 小项（any / verify 一键化） | ~30 分钟 | 顺手清理 |
| P3 | §6.1 lucide 首启提示 | 待定 | 产品决策，需讨论 |

## 8. 基线

- `npm run typecheck`：通过（strict 模式，`erasableSyntaxOnly` + `verbatimModuleSyntax`）
- `npm test`：147/147 通过，381ms
- 环境：pi-coding-agent 0.83.0 / 0.84.0，Node 22，VS Code 终端 + Kitty（lucide 字体已装）

## 9. 处理结果（2026-08-07）

| 事项 | 结果 |
| --- | --- |
| §3 恢复误标 | 已修：加 `executeIndex >= 0` 闸门。归因见上方「更正」 |
| §2.1 plan-mode 状态机测试 | 已加 `tests/plan-mode.test.ts`（17 条） |
| §2.2 goal-mode 状态机测试 | 已加 `tests/goal-mode.test.ts`（17 条） |
| §5 `any` 清理 | 已删 `subagents.ts` 两个 renderer 里从未使用的 `theme` 形参 |
| §5 verify-icons 一键化 | 已加 `npm run verify:icons`；lucide 表优先读 node_modules，读不到回落 `/tmp` |
| §5 git status 降级 | 无需改动，见下 |
| §4 wizard 提取 | 暂不做，见下 |
| §6.2 未提交改动 | `lucide-static` devDependency 已移除，`package-lock.json` 回到干净状态 |
| §6.1 lucide 首启提示 | 产品决策，仍待讨论 |

复核中改掉的、原报告没提到的一处：plan-mode 与 goal-mode 的会话恢复都在
`getEntries().pop()` 上取状态，而会话是一棵树 —— 用户 rewind 之后，文件顺序里最后一条
状态 entry 可能属于已被抛弃的分支，恢复出来的是别人的 executing/todos/轮次。
两处均改为 `getBranch()`（当前 root→leaf 路径），并注明不能换成 `buildContextEntries()`：
它会裁掉 compaction 割点之前的 entry，状态会直接丢。

两项判定为不需要动：

- **§5 git status 降级**：`pi.exec` 只 resolve 不 reject，超时走 SIGTERM 后返回非零码，
  `gitCache` 照常更新所以 TTL 退避仍然成立；初始缓存全 false，footer 本来就是
  「先只显示分支名，拿到结果再补状态」。已是建议的行为。
- **§4 wizard 提取**：三个 wizard 的差异在 `onHighlight` 预览与 `apply` 的落盘字段上，
  抽成泛型只把重复搬进参数对象，读的时候还得两头对照。现有重复克制，暂不动。

每条修复都做了变异验证：把 `getBranch()` 换回 `getEntries()`、把恢复闸门放宽成 `>= -1`、
把 goal 轮次上限改成 `>`，对应用例都会失败。当前基线：`npm test` 181/181，
`npm run typecheck` 通过，`npm run verify:icons` 全绿（62 图标 × 4 字形）。
