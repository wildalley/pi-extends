# Pi Extends

一个可安装到 [Pi](https://pi.dev/docs/latest) 的原生 TUI 扩展包，为日常编码工作提供统一控制台。

## 功能

- **Cockpit 主控制台**：`/cockpit` 打开一张卡片式面板——顶部实时显示模型 / 运行态 / 上下文占用，主体是按「外观 · 模型 · 工作流 · 系统」分组的菜单，每项右侧直接给出当前值。支持数字/字母热键直达、`/` 模糊搜索、光标记忆，主题与模型选择器可在移动光标时即时预览。
- **主题**：内置 `pi-carbon`（深色工业）、`pi-paper`（浅色纸张）、`pi-contrast`（高对比）、`pi-sakura`（樱色马卡龙）、`pi-terminal`（荧光绿 CRT），全部通过 WCAG 对比度校验；`/theme [名称]` 快速切换或打开选择器。
- **Cometix footer**：单行底部状态栏显示模型+thinking、当前目录、Git 分支与状态、上下文占比、token 用量、费用、任务时长与 TPS，颜色跟随主题；`/footer [tps]` 开关。
- **模型与角色**：为 Scout / Planner / Worker / Reviewer 四个角色分别绑定模型、thinking level 与工具权限，未指定时回退主模型。
- **路由角色**：把「用途」映射到模型——写提交信息用便宜模型、攻坚难题用慢模型、读图用多模态模型。`default / smol / slow / plan / commit / vision / designer / task / advisor / tiny` 十条路由，未配置的沿回退链落到主模型，全部为空也能正常工作。
- **Advisor 旁审**：每轮结束后由第二个模型在独立上下文里只读复查，把 `aside / concern / blocker` 等级的遗漏作为无边框卡片贴回转录区；走 `-ne` 子进程，绝不触发新一轮。
- **魔法关键词**：输入散文里出现 `ultrathink` / `orchestrate` / `workflowz` 时改写本轮行为；代码块、行内代码、路径与标识符中的同名词不触发。
- **自定义厂商**：支持 OpenAI Completions / OpenAI Responses / Anthropic Messages 兼容协议，API Key 只引用环境变量，注册后立即生效。
- **子代理**：`subagent` 工具支持 single / parallel / chain 三种模式，隔离上下文、流式进度、并发控制与中止传播。
- **Goal 模式**：`/goal` 提供 focused 与 autopilot 两种策略；autopilot 有硬性轮次上限，不会无限运行。
- **Plan 模式**：`/plan` 只读规划，禁用写工具与有副作用的 shell 命令；批准后追踪 `[DONE:n]` 步骤进度。

## 控制台一览

```
╭─ Pi Extends 控制台 ──────────────────────────── pi-carbon · v1 ─╮
│ ◆ 模型     claude-opus-4  ·  thinking high  ·  [已认证]         │
│ ◈ 运行     Goal off  ·  Plan off  ·  子代理并行 3  ·  厂商 2/5  │
│ ▤ 上下文   ━━━━━━━━━━━━ 42%  ·  38k / 200k                      │
├─────────────────────────────────────────────────────────────────┤
│ ╴ 外观 ╶─────────────────────────────────────────────────────── │
│ ▸ 1  ◐ 主题           移动光标即时预览              pi-carbon   │
│   2  ▤ 状态栏 Footer  cometix 单行 · TPS on                on   │
│ ╴ 模型 ╶─────────────────────────────────────────────────────── │
│   3  ◆ 主模型         thinking high      claude-opus-4-20250514 │
│   4  ◇ 角色模型与权限 scout · planner …           2/4 已定制    │
├─────────────────────────────────────────────────────────────────┤
│ ↑↓ 移动  ·  ⏎ 选择  ·  esc 返回                                 │
╰─────────────────────────────────────────────────────────────────╯
```

菜单入口：主题、Footer、主模型、角色模型与权限、路由角色、厂商、子代理
（可直接发起）、Goal、Plan、工作流提示词、Advisor 旁审、魔法关键词、状态
总览、配置文件。所有行按显示宽度精确对齐，
CJK 与 emoji 不会撑破边框；窄于 56 列时边框自动退化为横线规则。
面板只在 TUI 模式下渲染，`print`/`json`/`rpc` 模式回退为纯文本输出。

## 安装

```bash
# 在项目目录安装（写入 .pi/settings.json）
pi install /path/to/pi-extends -l

# 或全局安装
pi install /path/to/pi-extends
```

项目被 Pi 信任后，扩展与主题自动可用。卸载：

```bash
pi remove /path/to/pi-extends
```

## 快速开始

```bash
/cockpit                 # 打开主控制台
/theme                   # 主题选择器（/theme pi-sakura 直接切换）
/routes                  # 十条路由角色一页看全，回车进入单条编辑
/advisor                 # Advisor 旁审设置（/advisor on|off 直接切换）
/footer                  # 开关 cometix footer（/footer tps 切换 TPS）
/plan on                 # 进入只读 Plan 模式，让模型产出计划
/plan execute            # 批准并执行计划（跟踪 [DONE:n] 进度）
/goal start 修复登录缺陷 --autopilot   # 开始目标（自动推进）
/goal status             # 查看 Goal 状态
/config generate         # 生成示例配置到 .pi/pi-extends.json
```

魔法关键词在输入散文里直接生效，例如「把这段重构一下，orchestrate」会
自动派并行子代理分工，「workflowz」跑侦察→规划→实现→复审全流水线，
「ultrathink」把这一轮 thinking 临时提到 max 并在本轮结束后自动恢复。

子代理用法（由模型调用 `subagent` 工具）：

- 单个：`{ "role": "scout", "task": "定位认证相关代码" }`
- 并行：`{ "tasks": [{ "role": "scout", "task": "..." }, ...] }`
- 串行：`{ "chain": [{ "role": "scout", "task": "..." }, { "role": "worker", "task": "... {previous}" }] }`

也可直接使用工作流提示词：`/scout-and-plan <需求>`、`/implement <需求>`、`/implement-and-review <需求>`。

## 配置

配置文件为 `.pi/pi-extends.json`（项目级）与 `~/.pi/agent/pi-extends.json`（用户级），
项目级按字段覆盖用户级。示例见 `templates/pi-extends.example.json`，JSON Schema 见 `schemas/pi-extends.schema.json`。

配置分块：`theme`、`currentModel`、`roles`（四角色）、`routes`（按用途路由）、
`providers`（自定义厂商）、`subagents`、`goal`、`advisor`（旁审开关/等级/上限）、
`keywords`（魔法关键词开关）。

自定义厂商示例：

```json
{
  "providers": [
    {
      "id": "my-proxy",
      "name": "My Proxy",
      "baseUrl": "https://proxy.example.com/v1",
      "api": "openai-completions",
      "apiKeyEnv": "MY_LLM_API_KEY",
      "models": [{ "id": "my-model", "name": "My Model", "reasoning": false }]
    }
  ]
}
```

配置中只保存 `$MY_LLM_API_KEY` 这类环境变量引用，绝不写入密钥明文。

## 开发

```bash
npm install
npm run typecheck   # 类型检查
npm test            # 单元测试（Node 原生 test runner）
npm run pack:dry    # 打包检查
```

本地冒烟测试：`pi -e ./extensions/pi-extends`，或安装到测试项目后运行 `/cockpit`。

## 安全边界

- Plan 模式拦截 `edit`/`write` 与非只读 bash 命令，且禁止启动 worker 子代理。
- Goal autopilot 有硬性轮次上限，达到后自动暂停；用户中止时立即暂停。
- 自定义厂商 Base URL 保存前需确认；密钥只通过环境变量提供。
- 配置损坏时回退默认值并给出可理解警告，不阻止 Pi 启动。

## 许可证

MIT。第三方声明见 `THIRD_PARTY_NOTICES.md`。
