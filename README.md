# Pi Extends

一个可安装到 [Pi](https://pi.dev/docs/latest) 的原生 TUI 扩展包，为日常编码工作提供统一控制台。

## 功能

- **Cockpit 主控制台**：`/cockpit` 打开一张卡片式面板——顶部实时显示模型 / 运行态 / 上下文占用，主体按「外观 · 模型 · 工作流 · 自动化 · 系统」分栏，每项右侧直接给出当前值。`Tab`/`←→` 切栏、数字与字母热键直达（跨栏有效，按到别栏的键会自动切过去）、`/` 模糊搜索（跨全部栏）、光标记忆，主题与模型选择器在移动光标时即时预览。支持鼠标：点行移光标、再点确认，点 tab 名切栏，滚轮上下移动。
- **Coding plan 目录**：`/cockpit → 模型 → Coding Plan 与 API` 列出主流厂商的编码套餐与 API（Claude、ChatGPT、Kimi、GLM/智谱、OpenCode、Copilot、Grok、Qwen、DeepSeek、MiniMax、Groq、OpenRouter……），标出每一条对应的 provider id、能不能用订阅登录、环境变量叫什么，可直接填入 `/login`。这些厂商由 Pi 内置目录维护，本扩展不重复注册，只补「我买的套餐对应哪个 id」这段信息；表里没有的用自定义厂商兜底。
- **主题**：内置 `pi-carbon`（深色工业）、`pi-paper`（浅色纸张）、`pi-contrast`（高对比）、`pi-sakura`（樱色马卡龙）、`pi-terminal`（荧光绿 CRT），全部通过 WCAG 对比度校验；`/theme [名称]` 快速切换或打开选择器。
- **Cometix footer**：单行底部状态栏显示模型+thinking、当前目录、Git 分支与状态、上下文占比、token 用量、费用、任务时长与 TPS，颜色跟随主题；`/footer [tps]` 开关。
- **模型与角色**：为 Scout / Planner / Worker / Reviewer 四个角色分别绑定模型、thinking level 与工具权限，未指定时回退主模型。
- **路由角色**：把「用途」映射到模型——写提交信息用便宜模型、攻坚难题用慢模型、读图用多模态模型。`default / smol / slow / plan / commit / vision / designer / task / advisor / tiny` 十条路由，未配置的沿回退链落到主模型，全部为空也能正常工作。
- **Advisor 旁审**：每轮结束后由第二个模型在独立上下文里只读复查，把 `aside / concern / blocker` 等级的遗漏贴回转录区；转录区的意见始终不画框（那是聊天流，不是面板），不受 `border` 影响；走 `-ne` 子进程，绝不触发新一轮。
- **魔法关键词**：输入散文里出现 `ultrathink` / `orchestrate` / `workflowz` 时改写本轮行为；代码块、行内代码、路径与标识符中的同名词不触发。
- **自动分工**：一条消息里其实塞了好几件事时（列了几条待办、点名了好几个文件、篇幅很长、说了「所有/然后/顺便」），提醒把它拆成并行子代理。默认 `suggest`：弹一句问你，答「否」则本会话不再问；`auto` 直接注入，`off` 关闭。阈值可调，`/cockpit → 自动化 → 自动分工`。
- **自定义厂商**：支持 OpenAI Completions / OpenAI Responses / Anthropic Messages 兼容协议，API Key 只引用环境变量，注册后立即生效。
- **子代理**：`subagent` 工具支持 single / parallel / chain 三种模式，隔离上下文、流式进度、并发控制与中止传播。
- **Goal 模式**：`/goal` 提供 focused 与 autopilot 两种策略；autopilot 有硬性轮次上限，不会无限运行。
- **Plan 模式**：`/plan` 只读规划，禁用写工具与有副作用的 shell 命令；批准后追踪 `[DONE:n]` 步骤进度。

## 控制台一览

```
  ╭─ Pi Extends 控制台 ───────────────────────────────── pi-carbon · v1 ─╮
  │  ◆ 模型     claude-sonnet-4-5  ·  thinking high  ·  [已认证]         │
  │  ▣ 运行     Goal off  ·  Plan off  ·  子代理并行 4  ·  厂商 0/38     │
  │  ▮ 上下文   █████░░░░░░░ 42%  ·  38k / 200k                          │
  │  ▁ ▁▁▁▁▁▁▁▁▁ ▁▁▁▁ ▁▁▁ ▁▁ ▁▁ ▁ ▁ ▁ ▁ ▁ ▁ ▁  ▁  ▁   ▁    ▁             │
  │   外观  ·  模型  ·  工作流  ·  自动化  ·  系统                       │
  │                                                                      │
  │  ▌ 1  ◐ 主题                          pi-carbon                      │
  │    i  ✦ 图标集                           lucide                      │
  │    2  ▤ 状态栏 Footer                        on                      │
  │                                                                      │
  │       移动光标即时预览                                               │
  │                                                                      │
  │  ↑↓ 移动  ·  ⇥ 切栏  ·  / 搜索  ·  ⏎ 选择  ·  esc 返回               │
  ╰──────────────────────────────────────────────────────────────────────╯
```

（上图是 `unicode` 图标集的样子，好让没装字体的人也能看清排版；默认的 `lucide`
在装了字体的终端上是真正的 Lucide 图标。）

边框默认 `round` 圆角外框，标题嵌在上边框里而不再单独占一行——开框比不开只多
上下两行。`/cockpit → 外观 → 卡片边框` 可换成 `square` 方角，或 `none` 退回纯
缩进排版（终端本来就有一圈边框，不想再套一层的话选它），移动光标即时预览。
卡片外宽三种样式下都一样，开框吃掉的是内容宽度，不会把整张卡撑出终端。
分组改成顶部 tab 条，一屏只放当前一栏；说明文字固定在倒数第二行，
不跟着光标走——插在选中行下面的话，光标每移一格，下面所有行都会错开一行。
选中行只把底色铺到内容末尾而不是整行，避免右边拖出一条几十列宽的色块。
列表区高度与列宽按全部条目算一次而不是按当前栏，项少的栏补空行——
否则按一下 Tab，整张卡片连底部提示行会一起上下蹦、文字左右横跳。
分隔点、进度条空槽、翻页箭头都不用 `borderMuted`：实测它对各主题自己的背景
只有 1.30–2.48:1，画了等于没画。

菜单入口：主题、图标集、卡片边框、Footer、主模型、角色模型与权限、路由角色、厂商、coding plan
目录、子代理（可直接发起）、Goal、Plan、工作流提示词、Advisor 旁审、魔法关键词、
自动分工、状态总览、配置文件、Pi 自身设置。所有行按显示宽度精确对齐。
界面全程不用表情符号：emoji 占两列，会顶歪按一列排版的图标列，这一条由
`tests/icons.test.ts` 按实测宽度守住。面板只在 TUI 模式下渲染，
`print`/`json`/`rpc` 模式回退为纯文本输出。

## 图标

界面图标统一走 Lucide。终端画不了 SVG，用的是 Lucide 官方字体构建
（`lucide-static` 里的 `lucide.ttf`），图标在私有区码位上，把这个 ttf 加进终端的
fallback 字体链就有字形了。

四套字形，从好看到一定能显示：

| 图标集 | 说明 |
| --- | --- |
| `lucide` | 默认。需装 Lucide 字体，见下 |
| `nerd` | Nerd Font 补丁字体；开发机上的等宽字体多半已经打过这个补丁 |
| `unicode` | 几何图形与 Block Elements，任何字体都有 |
| `ascii` | 纯 ASCII，给 SSH 进老终端、日志重定向这类场合 |

`/cockpit → 外观 → 图标集` 把四套并排画出来 —— 哪套在你的终端里有字形一眼看得见，
是豆腐块的那套就是字体没装上。不确定装没装的时候，看一眼比查文档快。

装 Lucide 字体（Linux，其他平台把 ttf 装进系统字体即可）：

```bash
npm i -D lucide-static
mkdir -p ~/.local/share/fonts
cp node_modules/lucide-static/font/lucide.ttf ~/.local/share/fonts/
fc-cache -f
```

然后在终端的字体设置里把 `lucide` 加为 fallback（Kitty 用 `symbol_map`，
Alacritty / WezTerm 配 `font.fallback`，VS Code 终端设 `terminal.integrated.fontFamily`）。

急着救场不想配字体，用环境变量顶掉，它优先于配置文件：

```bash
export PI_EXTENDS_ICONS=unicode   # lucide | nerd | unicode | ascii
```

改图标表之后要跑一遍核对（比对上游码位表，码位写错本机是测不出来的）：

```bash
node tools/fetch-icon-tables.mjs
node --experimental-strip-types tools/verify-icons.mjs
node --experimental-strip-types tools/preview-cockpit.ts --icons   # 全表四套并排
```

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
/cockpit                 # 打开主控制台（Tab 切栏 · / 搜索 · 可鼠标点击）
/theme                   # 主题选择器（/theme pi-sakura 直接切换）
/roles                   # 四角色的模型、thinking 与工具权限
/routes                  # 十条路由角色一页看全，回车进入单条编辑
/advisor                 # Advisor 旁审设置（/advisor on|off 直接切换）
/agents                  # 手动发起 single / parallel / chain 子代理
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
忘了写关键词也没关系：一条消息里明显塞了好几件事时，自动分工会问一句要不要拆。

子代理用法（由模型调用 `subagent` 工具）：

- 单个：`{ "role": "scout", "task": "定位认证相关代码" }`
- 并行：`{ "tasks": [{ "role": "scout", "task": "..." }, ...] }`
- 串行：`{ "chain": [{ "role": "scout", "task": "..." }, { "role": "worker", "task": "... {previous}" }] }`

也可直接使用工作流提示词：`/scout-and-plan <需求>`、`/implement <需求>`、`/implement-and-review <需求>`。

粘贴图片是 Pi 自带的能力，不需要本扩展：输入框里直接 `Ctrl+V`（Windows 终端用
`Alt+V`），支持的终端里也可以把图片拖进去。读图建议把 `vision` 路由指向多模态模型。

## 配置

配置文件为 `.pi/pi-extends.json`（项目级）与 `~/.pi/agent/pi-extends.json`（用户级），
项目级按字段覆盖用户级。示例见 `templates/pi-extends.example.json`，JSON Schema 见 `schemas/pi-extends.schema.json`。

配置分块：`theme`、`icons`（图标集）、`border`（卡片边框 round/square/none）、
`currentModel`、`roles`（四角色）、
`routes`（按用途路由）、`providers`（自定义厂商）、`subagents`、`goal`、
`advisor`（旁审开关/等级/上限）、`keywords`（魔法关键词开关）、
`orchestration`（自动分工模式与阈值）。

刚装好时 `roles` 与 `routes` 都是空的——一切都跟着主模型走，直到你真的配了某一项。
这样「清空某条路由」才是一个能表达的动作：如果加载链从默认值开始，删掉的字段
下次启动又会被默认值填回来。想要一份写满的模板，用 `/config generate`。

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
- 自动分工默认只建议、不改写；答一次「否」之后本会话不再打扰。要它自己动手得显式设成 `auto`。
- 自定义厂商 Base URL 保存前需确认；密钥只通过环境变量提供。
- 配置损坏时回退默认值并给出可理解警告，不阻止 Pi 启动。

## 许可证

MIT。第三方声明见 `THIRD_PARTY_NOTICES.md`。
