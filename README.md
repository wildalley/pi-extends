# Pi Extends

一个可安装到 [Pi](https://pi.dev/docs/latest) 的原生 TUI 扩展包，为日常编码工作提供统一控制台。

## 功能

- **Cockpit 主控制台**：`/cockpit` 打开，管理主题、模型、角色、厂商、Goal 与 Plan。
- **主题**：内置 `pi-carbon`（深色工业）、`pi-paper`（浅色纸张）、`pi-contrast`（高对比）、`pi-sakura`（樱色马卡龙）、`pi-terminal`（荧光绿 CRT），全部通过 WCAG 对比度校验；`/theme [名称]` 快速切换或打开选择器。
- **Cometix footer**：单行底部状态栏显示模型+thinking、当前目录、Git 分支与状态、上下文占比、token 用量、费用、任务时长与 TPS，颜色跟随主题；`/footer [tps]` 开关。
- **模型与角色**：为 Scout / Planner / Worker / Reviewer 四个角色分别绑定模型、thinking level 与工具权限，未指定时回退主模型。
- **自定义厂商**：支持 OpenAI Completions / OpenAI Responses / Anthropic Messages 兼容协议，API Key 只引用环境变量，注册后立即生效。
- **子代理**：`subagent` 工具支持 single / parallel / chain 三种模式，隔离上下文、流式进度、并发控制与中止传播。
- **Goal 模式**：`/goal` 提供 focused 与 autopilot 两种策略；autopilot 有硬性轮次上限，不会无限运行。
- **Plan 模式**：`/plan` 只读规划，禁用写工具与有副作用的 shell 命令；批准后追踪 `[DONE:n]` 步骤进度。

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
/footer                  # 开关 cometix footer（/footer tps 切换 TPS）
/plan on                 # 进入只读 Plan 模式，让模型产出计划
/plan execute            # 批准并执行计划（跟踪 [DONE:n] 进度）
/goal start 修复登录缺陷 --autopilot   # 开始目标（自动推进）
/goal status             # 查看 Goal 状态
/config generate         # 生成示例配置到 .pi/pi-extends.json
```

子代理用法（由模型调用 `subagent` 工具）：

- 单个：`{ "role": "scout", "task": "定位认证相关代码" }`
- 并行：`{ "tasks": [{ "role": "scout", "task": "..." }, ...] }`
- 串行：`{ "chain": [{ "role": "scout", "task": "..." }, { "role": "worker", "task": "... {previous}" }] }`

也可直接使用工作流提示词：`/scout-and-plan <需求>`、`/implement <需求>`、`/implement-and-review <需求>`。

## 配置

配置文件为 `.pi/pi-extends.json`（项目级）与 `~/.pi/agent/pi-extends.json`（用户级），
项目级按字段覆盖用户级。示例见 `templates/pi-extends.example.json`，JSON Schema 见 `schemas/pi-extends.schema.json`。

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
