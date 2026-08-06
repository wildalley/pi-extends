# Pi Extends 实施计划

## 1. 项目目标

构建一个可安装到 [Pi](https://pi.dev/docs/latest) 的原生 TUI 扩展包，为日常编码工作提供统一控制台，而不是重新实现一套聊天客户端。

首个版本需要覆盖：

1. 在 TUI 内浏览、预览并切换 Pi 主题。
2. 快速选择多个模型，并将模型分配给不同职责。
3. 运行单个、并行或串行子代理。
4. 提供可持久化、可限轮次自动推进的 Goal 模式。
5. 提供严格只读、可生成并执行步骤的 Plan 模式。
6. 支持 Pi 内置厂商，也允许添加 OpenAI、Anthropic 兼容的自定义厂商。
7. 将配置保存为可审阅、可提交、可手工编辑的 JSON 文件。

## 2. 设计原则

- **原生集成**：使用 Pi Extension API、TUI 组件、Provider API 和 session entry，不代理或替换 Pi 主进程。
- **配置即代码**：项目配置保存在 `.pi/pi-extends.json`，不把 API Key 明文写入仓库。
- **安全优先**：Plan 模式必须阻断写工具和有副作用的 shell 命令；Goal 自动推进必须有明确轮次上限。
- **渐进使用**：只切换主题或模型时，不要求先配置子代理和 Goal 模式。
- **兼容现有 Pi**：首版以本机已安装的 `@earendil-works/pi-coding-agent 0.83.0` 和 `pi.dev/docs/latest` 为兼容基线。
- **可分发**：项目最终可通过 `pi install ./` 或 GitHub 仓库地址安装。

## 3. 用户体验

安装后，用户在 Pi 中执行 `/cockpit` 打开主控制台。

主控制台显示：

- 当前主题、主模型和 thinking level。
- Scout、Planner、Worker、Reviewer 四个角色的模型分配。
- 当前 Goal 状态、自动推进轮次和最近进度。
- Plan 模式状态和计划执行进度。
- 已注册的自定义厂商数量。

主菜单提供以下入口：

1. `Theme`：切换 Pi 内置主题和本包主题。
2. `Footer`：开关 cometix 单行状态栏与 TPS。
3. `Current model`：切换当前会话主模型及 thinking level。
4. `Role models`：分别设置角色使用的模型、thinking level 和工具权限。
5. `Routes`：按用途给模型分工（default/smol/slow/plan/commit/vision/designer/task/advisor/tiny），沿回退链落到主模型。
6. `Providers`：查看内置厂商认证状态，添加、修改或移除自定义厂商。
7. `Subagents`：查看角色配置并发起单个、并行或串行任务。
8. `Goal mode`：创建、暂停、恢复、完成或清除目标。
9. `Plan mode`：进入只读规划、查看计划、批准执行或继续修改。
10. `Prompts`：把工作流提示词填入编辑器。
11. `Advisor`：旁审开关、最低展示等级与本会话上限。
12. `Keywords`：魔法关键词总开关。
13. `Config`：生成示例、校验当前配置、显示配置路径。

同时保留适合熟练用户的直接命令：

- `/cockpit`
- `/theme [名称]`
- `/routes`
- `/roles`
- `/agents`
- `/advisor [on|off]`
- `/goal [start|status|pause|resume|complete|clear]`
- `/plan [on|off|status|execute]`
- `/config [status|generate|validate]`

主界面以卡片式菜单呈现：顶部三行实时状态（模型 / 运行态 / 上下文占用），
主体按「外观 · 模型 · 工作流 · 系统」分组，每项右侧显示当前值；支持数字/字母
热键直达、`/` 模糊搜索与光标记忆，主题与模型选择器在移动光标时即时预览。
所有行按显示宽度对齐（CJK/emoji 不撑破边框），窄于 56 列时边框退化，
非 TUI 模式回退为纯文本输出。

## 4. 技术架构

计划采用一个 Pi package，约定目录如下：

```text
pi-extends/
├── package.json
├── tsconfig.json
├── README.md
├── PLAN.md
├── THIRD_PARTY_NOTICES.md
├── schemas/
│   └── pi-extends.schema.json
├── extensions/
│   └── pi-extends/
│       ├── index.ts
│       ├── cockpit.ts
│       ├── config.ts
│       ├── providers.ts
│       ├── roles.ts
│       ├── subagents.ts
│       ├── goal-mode.ts
│       ├── plan-mode.ts
│       ├── plan-utils.ts
│       ├── routes.ts
│       ├── advisor.ts
│       ├── advisor-parse.ts
│       ├── keywords.ts
│       ├── pickers.ts
│       ├── ui-kit.ts
│       ├── footer.ts
│       ├── runtime.ts
│       └── store.ts
├── themes/
│   ├── pi-carbon.json
│   ├── pi-paper.json
│   ├── pi-contrast.json
│   ├── pi-sakura.json
│   └── pi-terminal.json
├── prompts/
│   ├── scout-and-plan.md
│   ├── implement.md
│   └── implement-and-review.md
├── templates/
│   └── pi-extends.example.json
└── tests/
    ├── config.test.ts
    ├── goal-mode.test.ts
    ├── plan-utils.test.ts
    ├── subagent-parse.test.ts
    ├── advisor-parse.test.ts
    ├── keywords.test.ts
    ├── routes.test.ts
    ├── ui-kit.test.ts
    └── ui-kit-render.test.ts
```

根 `package.json` 的 Pi manifest 与依赖约定：

- `keywords` 包含 `pi-package`。
- `pi.extensions`、`pi.prompts`、`pi.themes` 显式声明资源目录（不依赖约定目录自动发现，保证 `extensions/pi-extends/index.ts` 会被加载）。
- `@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui`、`typebox` 放在 `peerDependencies`（`"*"` 范围），不打包。
- 运行时第三方依赖放 `dependencies`；`npm test` 等开发工具放 `devDependencies`。

模块职责：

- `index.ts`：注册命令、工具、provider 和生命周期事件。
- `cockpit.ts`：主控制台及各配置向导（含厂商、子代理、Goal、Plan、提示词、Advisor、关键词菜单）。
- `config.ts`：读取、合并、校验和原子写入配置；路由解析与回退链。
- `providers.ts`：内置厂商信息、自定义 provider 注册和模型发现。
- `roles.ts`：角色默认值、模型映射和权限策略。
- `subagents.ts`：启动隔离 Pi 子进程、并发控制、流式结果汇总和中止传播。
- `goal-mode.ts`：目标状态机、会话持久化、提示注入和受限自动推进。
- `plan-mode.ts`：只读工具集、计划提取、批准执行和步骤进度。
- `routes.ts`：十条路由角色编辑向导；解析优先级 自身配置 → 回退链 → 主模型。
- `advisor.ts`：每轮后旁审子进程调度、消息卡片注入与开关。
- `advisor-parse.ts`：旁审输出的纯函数解析、过滤与渲染。
- `keywords.ts`：魔法关键词检测（只在散文生效）与输入改写。
- `pickers.ts`：主题 / 模型 / thinking 选择器，移动光标即时预览。
- `ui-kit.ts`：卡片式菜单、状态行、宽度对齐、搜索与热键的通用组件。
- `footer.ts`：cometix 单行状态栏与 TPS 追踪，导出控制句柄供 cockpit 读写。
- `runtime.ts`：运行时 API 单例。
- `store.ts`：配置读取与原子更新的单例。

## 4.1 路由角色

路由把「用途」映射到模型，配置是渐进式的（十条路由全空也能正常工作）：

- 预设 `default / smol / slow / plan / commit / vision / designer / task / advisor / tiny` 十条路由，各带说明与默认回退链。
- 解析顺序：路由自身配置 → 沿回退链找第一个显式模型 → 主模型；thinking 取回退链上第一个显式值。
- 例如 `plan` 未配模型时回退 `slow → default → 主模型`；`commit` 回退 `smol → default`。
- 自定义回退链优先于默认链；存在环时安全终止。

## 4.2 Advisor 旁审

每轮结束后让第二个模型在独立上下文里只读复查刚才的一来一回：

- 走子进程（与 subagent 同一套 `pi` 调用），带 `-ne` 且设环境变量兜底，避免旁审递归拉起旁审。
- 只给只读工具，`sendMessage({ triggerTurn: false })`，永远不会替用户发起新一轮。
- 子进程输出 `aside|concern|blocker :: 标题 :: 说明`，解析为无边框卡片贴回转录区，低于阈值的丢弃。
- 配置含开关、最低展示等级与本会话最大条数，通过 `/advisor` 或 cockpit 控制。

## 4.3 魔法关键词

输入散文里出现 `ultrathink / orchestrate / workflowz` 时改写本轮行为：

- 只在「散文」生效：代码块、行内代码、XML/HTML 标签、标识符与路径中的同名词一律不触发。
- `ultrathink` 把当轮 thinking 提到 max，本轮结束后自动恢复原值。
- `orchestrate` 改写为派并行子代理分工；`workflowz` 改写为 scout → planner → worker → reviewer 全流水线。

## 4.4 自动分工

关键词的前提是用户记得写。真会一次丢五件事进来的人，正忙着描述这五件事。
所以额外给一条「提醒」路径：给每条交互输入打一个可解释的复杂度分，超过阈值就
建议拆成并行子代理。拆分指令复用 `keywords.ts` 里 `orchestrate` 那一份，不另写 prompt。

- 信号：待办条数（`1.` `-` `第三步`）、先后顺序词、覆盖面词（所有/每个/重构/迁移）、
  点名文件数、散文篇幅。每个信号都能对着原文指出来，弹窗里直接把理由列给用户。
- 只看散文，掩码与关键词共用 `maskNonProse`：贴一段 diff 进来不会因为里面的 `-`
  和文件名被判成五件事。版本号（`gpt-4.1`、`3.5`）不算待办项。
- 三种模式：`off` 不看；`suggest`（默认）弹一句问，答「否」则本会话不再问；
  `auto` 直接注入并发一条通知。阈值 `minComplexity` 默认 3 分。
- 不触发的场合：非交互输入（rpc / extension）、流式插话（steer）、用户自己
  已经写了魔法关键词、没有 UI 的模式。

首要风险是误触而不是漏判，所以 `tests/orchestration.test.ts` 里防误触的用例更多。

## 5. 配置格式

项目级配置文件为 `.pi/pi-extends.json`。首版结构如下：

```json
{
  "$schema": "./pi-extends.schema.json",
  "version": 1,
  "theme": "pi-carbon",
  "currentModel": {
    "model": "anthropic/claude-sonnet-4-5",
    "thinking": "high"
  },
  "roles": {
    "scout": {
      "model": "google/gemini-2.5-flash",
      "thinking": "low",
      "tools": ["read", "grep", "find", "ls"]
    },
    "planner": {
      "model": "openai/gpt-5.2",
      "thinking": "high",
      "tools": ["read", "grep", "find", "ls"]
    },
    "worker": {
      "model": "anthropic/claude-sonnet-4-5",
      "thinking": "high",
      "tools": ["read", "bash", "edit", "write"]
    },
    "reviewer": {
      "model": "openai/gpt-5.2",
      "thinking": "high",
      "tools": ["read", "grep", "find", "ls"]
    }
  },
  "providers": [],
  "subagents": {
    "maxParallelTasks": 8,
    "maxConcurrency": 4
  },
  "goal": {
    "defaultMode": "focused",
    "maxAutoTurns": 5
  },
  "routes": {
    "default": { "model": "anthropic/claude-sonnet-4-5", "thinking": "high" },
    "smol": { "model": "google/gemini-2.5-flash", "thinking": "low" },
    "slow": { "model": "openai/gpt-5.2", "thinking": "max" },
    "plan": { "thinking": "high", "fallback": ["slow", "default"] },
    "commit": { "thinking": "off", "fallback": ["smol", "default"] },
    "vision": { "model": "google/gemini-2.5-flash", "thinking": "low" },
    "designer": { "fallback": ["slow", "default"] },
    "task": { "thinking": "medium" },
    "advisor": { "thinking": "high", "fallback": ["slow", "default"] },
    "tiny": { "model": "google/gemini-2.5-flash", "thinking": "off" }
  },
  "advisor": {
    "enabled": false,
    "minSeverity": "concern",
    "maxPerSession": 20
  },
  "keywords": {
    "enabled": true
  },
  "orchestration": {
    "mode": "suggest",
    "minComplexity": 3
  }
}
```

配置加载规则：

1. 使用内置安全默认值。
2. 加载用户级 `~/.pi/agent/pi-extends.json`。
3. 项目被 Pi 信任后，加载 `.pi/pi-extends.json` 并覆盖用户级同名字段。
4. 无效字段给出 TUI 警告，但不阻止 Pi 启动。
5. TUI 写配置时使用临时文件加原子替换，避免中断造成半写入 JSON。

## 6. 模型与厂商

### 6.1 内置厂商

直接复用 Pi 的 model registry，不复制模型目录。重点展示常用厂商及认证状态：

- Anthropic
- OpenAI / OpenAI Codex
- Google Gemini
- DeepSeek
- OpenRouter
- Groq
- Mistral
- Moonshot / Kimi
- MiniMax
- 本机已由 Pi 注册的其他厂商

角色选择器默认只显示认证可用的模型，并允许切换到“显示全部模型”以完成预配置。

### 6.2 自定义厂商

首版支持以下协议：

- `openai-completions`
- `openai-responses`
- `anthropic-messages`

配置向导收集：

- provider ID 和显示名称。
- Base URL。
- API 协议。
- API Key 对应的环境变量名，例如 `MY_LLM_API_KEY`。
- 一个或多个模型 ID。
- reasoning、图像输入、context window 和 max tokens。

配置中只保存 `$ENV_VAR` 引用，不保存密钥值。新增 provider 后立即注册到当前会话，无需重启；必要时刷新 model registry。

## 7. 多模型分工与子代理

### 7.1 默认角色

- **Scout**：快速定位文件、调用关系和相关实现；只读。
- **Planner**：综合上下文并输出可执行计划；只读。
- **Worker**：负责实现和验证；允许完整编码工具。
- **Reviewer**：以代码审查方式检查缺陷、回归和测试缺口；只读。

未指定角色模型时，回退到当前主模型。角色可分别配置 thinking level、工具列表和附加系统提示。

### 7.2 子代理执行方式

注册 LLM 工具 `subagent`，支持：

- `single`：一个角色执行一个任务。
- `parallel`：多个相互独立任务并行执行。
- `chain`：后一步通过 `{previous}` 引用前一步结果。

每个子代理使用独立的 `pi --mode json -p --no-session` 进程和独立上下文。父进程负责：

- 限制任务数量和并发度。
- 解析 JSONL 事件并实时更新 TUI。
- 汇总最终文本、模型、token、费用、退出码和错误。
- 将父级 AbortSignal 传播为子进程终止信号。
- 限制单任务回传大小，完整结果保留在 tool details 中。

Plan 模式中禁止启动具有写权限的子代理。首版采用保守策略：规划阶段仅允许 Scout、Planner、Reviewer。

## 8. Goal 模式

Goal 模式包含两种策略：

- `focused`：每轮都注入目标和最新进度，但只响应用户发起的轮次。
- `autopilot`：代理在一轮结束后自动继续，直到完成、阻塞、用户中止或达到轮次上限。自动推进由 `agent_settled` 事件触发，通过 `pi.sendUserMessage` 发起下一轮。

状态机：

```text
inactive -> active -> paused -> active
                    -> blocked
                    -> completed
                    -> cancelled
```

Goal 状态保存在 Pi session custom entries 中，包括：

- 目标文本。
- 当前状态。
- focused/autopilot 策略。
- 已使用轮次和最大轮次。
- 最近进度说明。
- 完成摘要或阻塞原因。

注册 `goal` 工具供模型调用：

- `status`
- `update`
- `complete`
- `block`

安全限制：

- autopilot 必须由用户明确选择。
- 默认最多自动推进 5 轮。
- 达到上限后自动暂停，不继续产生费用。
- 有待处理消息、Plan 模式仍在规划或代理报告阻塞时不自动续跑。
- Ctrl+C 仍由 Pi 负责中止当前轮次；Goal 状态随即暂停。

## 9. Plan 模式

Plan 模式以 Pi 官方 GitHub 示例为基线，并补充与本项目其他模块的联动。

启用后：

- 禁用 `edit` 和 `write`。
- Bash 只允许明确列出的只读命令。
- 拦截重定向、包安装、Git 写操作和其他有副作用命令。
- 在系统上下文中明确要求输出 `Plan:` 标题下的编号步骤。
- 从最终回答中提取步骤并显示为 TUI 列表。
- 用户可选择“执行计划”“继续规划”或“修改计划”。

批准执行后：

- 恢复进入 Plan 模式前的工具集合。
- 通过 `[DONE:n]` 标记追踪步骤完成度。
- 在编辑器上方显示剩余步骤。
- 所有步骤完成后清理执行状态并保留完成消息。

Plan 与 Goal 同时使用时：

- Goal 可以要求 Planner 产出计划。
- 未批准计划前，Goal autopilot 不自动进入实现阶段。
- 用户批准执行后，Goal 可以继续自动推进，但仍受 Goal 轮次上限约束。

## 10. 主题

包内提供五个完整主题，并保留 Pi 的 `dark`、`light` 主题：

- `pi-carbon`：中性深色工作台，使用青色、绿色、琥珀色和红色区分语义。
- `pi-paper`：适合浅色终端的高可读主题。
- `pi-contrast`：适合低质量显示器和远程终端的高对比主题。
- `pi-sakura`：樱色马卡龙配色。
- `pi-terminal`：荧光绿 CRT 配色。

切换时调用 `ctx.ui.setTheme()` 立即生效，并把选择写入配置。每个主题包含 Pi 要求的全部颜色 token，并通过 WCAG 对比度校验。

## 11. 安全与信任边界

- 项目级扩展和配置只在 Pi 信任项目后加载。
- 自定义 provider 的 Base URL 在保存前展示确认，避免误把请求发送到未知服务。
- API Key 只通过环境变量或 Pi 自身认证机制提供。
- 子代理继承明确的 cwd、角色工具白名单和中止信号。
- Advisor 旁审子进程带 `-ne` 并设环境变量兜底，避免递归拉起旁审；只给只读工具且不触发新一轮。
- shell 调用使用参数数组，不拼接用户输入为 shell 命令。
- 角色名、provider ID、路由名和模型 ID 进行格式校验。
- 配置解析失败时继续使用上一个有效配置或默认值。
- 自动模式有硬性轮次上限，不提供无限循环选项。

## 12. 开源复用

优先复用 Pi 官方仓库 `earendil-works/pi` 中的 MIT 示例：

- `examples/extensions/subagent/`
- `examples/extensions/plan-mode/`
- `examples/extensions/preset.ts`
- `examples/extensions/todo.ts`

会在 `THIRD_PARTY_NOTICES.md` 中记录来源、许可证和改动范围。外部依赖保持最少，首版只依赖 Pi 已提供的 peer packages 与 `typebox`。

## 13. 实施阶段

> 状态：首版五阶段均已实现并通过测试（`npm run typecheck`、`npm test`、真实 Pi TUI 冒烟）。
> 阶段四之后追加了路由角色、Advisor 旁审、魔法关键词与卡片式控制台（见 4.1–4.3）。

### 阶段一：包与配置基础 ✅

- 创建 `package.json`（含 `pi` manifest、`peerDependencies`）、TypeScript 配置。
- 定义配置类型、默认值、合并、校验和原子保存。
- 添加示例配置和 JSON Schema。

完成标准：无配置时可加载；损坏配置只产生可理解的警告。

### 阶段二：Cockpit、主题和模型 ✅

- 实现 `/cockpit` 主界面（卡片式菜单，含实时状态、热键、搜索与即时预览）。
- 添加主题资源与即时切换。
- 实现当前模型、thinking level 和角色模型配置。
- 实现内置厂商状态页和自定义 provider 向导。

完成标准：配置可在 TUI 中完成并跨 Pi 会话恢复。

### 阶段三：子代理 ✅

- 实现角色提示和工具权限。
- 实现 single、parallel、chain 三种执行方式。
- 添加并发限制、流式状态、错误处理和中止传播。

完成标准：不同角色可使用不同模型完成同一工作流，失败任务不影响其他并行任务的结果收集。

### 阶段四：Goal 与 Plan ✅

- 实现 Goal 状态机、持久化、状态组件和受限续跑。
- 移植并调整官方 Plan 模式。
- 完成两种模式与子代理的权限联动。

完成标准：Plan 期间无法通过内置工具或子代理写入；Goal 达到轮次上限后必定停止。

### 阶段四+：路由、旁审与关键词 ✅

- 实现十条路由角色编辑页与回退链解析。
- 实现 Advisor 旁审（独立上下文子进程、只读工具、卡片渲染）。
- 实现魔法关键词输入改写与当轮 thinking 恢复。

完成标准：路由全空可正常运行；旁审不递归、不触发新一轮；关键词只在散文生效。

### 阶段五：文档与发布验证 ✅

- 完成中文 README、安装、配置和使用示例。
- 添加第三方声明和许可证。
- 运行单元测试、类型检查、package 打包检查和真实 Pi TUI 冒烟测试。

完成标准：`pi install ./` 后可直接运行 `/cockpit`，卸载不遗留项目外文件。

### 阶段六：TUI 打磨、coding plan 目录与自动分工 ✅

- 卡片去掉边框、分组改为顶部 tab 条、接入鼠标（点行/点 tab/滚轮）。
- 说明文字固定在卡片尾行，消除光标移动带来的整列抖动；选中行底色只铺到内容末尾；
  未选中的直达键从 `borderMuted` 改为 `dim`（深色终端上约 2.2:1 → 3.7:1）。
- 新增 coding plan 目录：列出内置厂商对应的订阅套餐、认证方式与环境变量名，
  认证能力现从 provider 对象读取而不是写死枚举。
- 新增自动分工（见 4.4），并在 cockpit「自动化」栏给出模式与阈值入口。
- 分栏几何固定：列表区高度与列宽按全部条目算一次，项少的栏补空行 —— 否则
  切一次 tab 整张卡片连底部提示行一起上下蹦、标签与数值列左右横跳。
  分组同时按条数配平（2/5/4/3/3），最空的一栏只补三行。
- 快捷键改为跨栏生效：按到别栏的键先切栏再选中。卡片上写着 `3`，
  不该因为「你正好停在外观栏」而失灵。
- `borderMuted` 不再用于上色：实测它对各主题**自己的页面背景**只有 1.30–2.48:1
  （pi-carbon 1.36 / pi-sakura 1.30），分隔点、进度条空槽、翻页箭头、空勾选框
  曾经全用它，等于这些唯一提示一个都看不见。统一改 `dim`（4.29–8.63:1），
  并新增源码级断言防回归。进度条实心段与空槽改用密度不同的 `█` / `░`，
  不靠颜色区分填到哪儿。
- 加载链起点由 `defaultConfig()` 改为 `emptyBase()`：`roles`/`routes` 未配置就是
  未配置，删除操作不会被默认值填回来；`/config generate` 仍产出完整模板。

完成标准：卡片每行显示宽度精确等于卡片宽度且不含边框字符；切栏前后高度与列宽不变；
overlay 不裁掉底部提示行；普通消息不会触发自动分工。
排版改动用 `tools/preview-cockpit.ts` 拿真实主题渲染肉眼复核 —— 对齐能断言，好不好看不能。

## 14. 测试计划

### 单元测试（已落地 126 条，`npm test`）

- 默认配置和深度合并（`config.test.ts`）。
- 无效 JSON、错误字段和旧版本配置（`config.test.ts`）。
- provider/model ID 与环境变量名校验（`config.test.ts`）。
- 路由回退链解析与环检测（`routes.test.ts`）。
- Advisor 输出解析、过滤与排序（`advisor-parse.test.ts`）。
- 关键词散文检测与掩码（`keywords.test.ts`）。
- 卡片布局与宽度对齐（`ui-kit.test.ts`、`ui-kit-render.test.ts`）。
- Plan 只读命令 allowlist/denylist、计划步骤与 `[DONE:n]` 提取（`plan-utils.test.ts`、
  `plan-safety.test.ts`）。
- Goal 状态转换和最大轮次边界（`goal-mode.test.ts`）。
- 子代理 JSONL 事件解析与输出截断（`subagent-parse.test.ts`）。
- 自动分工打分：短消息与普通长段落不到阈值、代码块与版本号不算数、
  重复词只计一次、有分必有理由（`orchestration.test.ts`）。
- 卡片 tab 切换、鼠标点击命中与说明行位置固定（`ui-kit-tabs.test.ts`、
  `ui-kit-render.test.ts`、`mouse.test.ts`、`mouse-lifecycle.test.ts`）。
- 主题在 selectedBg 上的对比度、源码不再用 `borderMuted` 上色（`ui-kit-contrast.test.ts`）。
- 切栏后卡片高度与列宽不变、快捷键跨栏生效（`ui-kit-tabs.test.ts`）。
- coding plan 目录的 provider id 与环境变量名对得上上游（`plans.test.ts`）。
- 配置作用域与项目/用户级覆盖（`store-scope.test.ts`）。

### 集成测试（已通过真实 Pi TUI 冒烟）

- `pi --list-models` / 启动加载验证扩展、提示词与主题被发现。
- 真实 PTY 中打开 `/cockpit`、`/routes`、`/advisor`、`/keywords` 并完成切换。
- 主题切换立即生效并在重启后恢复；配置原子写回 `.pi/pi-extends.json`。
- Goal/Plan/footer/agents/config 命令路径均无异常。
- 在临时 `PI_CODING_AGENT_DIR` 中验证不污染用户配置。

### 打包测试

- `npm run typecheck`
- `npm test`
- `npm pack --dry-run`
- `pi install ./ -l` 后检查资源发现结果。

## 15. 首版验收标准

- `/cockpit` 能在 Pi TUI 中打开并返回，不破坏输入编辑器状态。
- 主题切换立即生效，重启后仍应用所选主题。
- 四个默认角色可以绑定不同 provider/model。
- 十条路由可按用途分工，未配置的沿回退链落到主模型。
- 至少一个自定义 OpenAI-compatible provider 可通过环境变量认证并出现在模型列表。
- `subagent` 支持 single、parallel、chain，并可中止。
- Goal focused/autopilot 均可用，autopilot 永远不会超过配置轮次。
- Plan 模式能阻止写操作，并在批准后追踪执行步骤。
- Advisor 旁审可开关，子进程隔离，不触发新一轮。
- 魔法关键词在散文里生效，代码块/标识符/路径中不误触。
- 所有配置均可手工审阅，不含明文密钥。
- 测试、类型检查和 Pi 加载冒烟测试通过。

## 16. 暂不纳入首版

- 在 TUI 中保存或管理明文 API Key。
- 自定义 OAuth 登录流程。
- 跨机器同步会话和密钥。
- 图形化工作流拖拽编辑器。
- 无限轮次的自治代理。
- 非 OpenAI/Anthropic 兼容协议的自定义流式实现。

