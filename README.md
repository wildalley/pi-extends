# Pi Extends

一个可安装到 [Pi](https://pi.dev/docs/latest) 的原生 TUI 扩展包，为日常编码工作提供统一控制台。

## 功能

- **Cockpit 主控制台**：`/cockpit` 打开一张卡片式面板——顶部实时显示模型 / 运行态 / 上下文占用，主体按「外观 · 模型 · 工作流 · 自动化 · 系统」分栏，每项右侧直接给出当前值。`Tab`/`←→` 切栏、数字与字母热键直达（跨栏有效，按到别栏的键会自动切过去）、`/` 模糊搜索（跨全部栏）、光标记忆，主题与模型选择器在移动光标时即时预览。支持鼠标：点行移光标、再点确认，点 tab 名切栏，滚轮上下移动。
- **Coding plan 目录**：`/cockpit → 模型 → Coding Plan 与 API` 列出主流厂商的编码套餐与 API（Claude、ChatGPT、Kimi、GLM/智谱、OpenCode、Copilot、Grok、Qwen、DeepSeek、MiniMax、Groq、OpenRouter……），标出每一条对应的 provider id、能不能用订阅登录、环境变量叫什么，可直接填入 `/login`。这些厂商由 Pi 内置目录维护，本扩展不重复注册，只补「我买的套餐对应哪个 id」这段信息；表里没有的用自定义厂商兜底。
- **主题**：内置 `pi-carbon`（深色工业）、`pi-paper`（浅色纸张）、`pi-contrast`（高对比）、`pi-sakura`（樱色马卡龙）、`pi-terminal`（荧光绿 CRT），全部通过 WCAG 对比度校验；`/theme [名称]` 快速切换或打开选择器。
- **Cometix footer**：单行底部状态栏显示模型+thinking、当前目录、Git 分支与状态、上下文占比、token 用量、费用、任务时长与 TPS，颜色跟随主题；`/footer [tps]` 开关。有缓存命中时显示 `CH92.3%`；上游明确返回缓存字段、跑满 3 轮且累计重发超过 20 万输入 token 却一次都没命中时显示红色 `CH0%`。第三方中转若省略 `cacheRead/cacheWrite`，则显示红色 `CH?`，只提示“指标未上报或尚未命中”，不会把漏报断言成未命中。`/cache` 展示当前分支最近 8 轮的缓存提示、指标可信度和命中证据。
- **模型与角色**：为 Scout / Planner / Worker / Reviewer 四个角色分别绑定模型、thinking level 与工具权限，未指定时回退主模型。
- **路由角色**：把「用途」映射到模型——写提交信息用便宜模型、攻坚难题用慢模型、读图用多模态模型。`default / smol / slow / plan / commit / vision / designer / task / advisor / tiny` 十条路由，未配置的沿回退链落到主模型，全部为空也能正常工作。
- **Advisor 旁审**：每轮结束后由第二个模型在独立上下文里只读复查，把 `aside / concern / blocker` 等级的遗漏贴回转录区；转录区的意见始终不画框（那是聊天流，不是面板），不受 `border` 影响；走 `-ne` 子进程，绝不触发新一轮。
- **魔法关键词**：输入散文里出现 `ultrathink` / `orchestrate` / `workflowz` 时改写本轮行为；代码块、行内代码、路径与标识符中的同名词不触发。
- **自动分工**：一条消息里其实塞了好几件事时（列了几条待办、点名了好几个文件、篇幅很长、说了「所有/然后/顺便」），提醒把它拆成并行子代理。默认 `suggest`：弹一句问你，答「否」则本会话不再问；`auto` 直接注入，`off` 关闭。阈值可调，`/cockpit → 自动化 → 自动分工`。
- **自定义厂商**：支持 OpenAI Completions / OpenAI Responses / Anthropic Messages 兼容协议，API Key 只引用环境变量，注册后立即生效。
- **子代理**：`subagent` 工具支持 single / parallel / chain 三种模式，隔离上下文、流式进度、并发控制与中止传播。运行期间 footer 多出一段 `2/3 子代理`（跑完变成 `3 子代理` 或 `1/3 子代理失败`，下一轮开始时清空）；这一段走 pi 的 extension status 槽，因此换成 pi 自带 footer 也照样显示。详情不在 footer 里看 —— footer 拿不到焦点也收不到鼠标事件（pi 只在 alt-screen 里开鼠标上报），子代理的完整输出在转录区，`Ctrl+O` 展开，或 `/agents` 重新发起。
- **桌面通知**：pi 自己不发任何系统通知（也不响铃），本扩展补上：Linux 走 `notify-send`、macOS 走 `osascript`，其他平台静默跳过。默认关闭 —— SSH / 容器里没有通知守护进程，开着只会每轮白跑一个子进程。`/cockpit → 自动化 → 桌面通知` 打开，可分别控制「回合结束」（默认 20s 以上的回合才通知）、「Advisor 阻塞」（不受时长限制）、「每个子代理」（默认关，派得多会很吵），页内有「发一条试试」当场验证通道。通知正文经过 ANSI/控制字符清洗，且通过 `pi.exec(command, args[])` 传参、不经 shell，模型输出里的 `$(...)`、反引号不可能变成命令。
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
自动分工、桌面通知、状态总览、配置文件、Pi 自身设置。所有行按显示宽度精确对齐。
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
npm run verify:icons                                              # 拉上游表 + 核对，一条命令
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
/cache                   # 最近回合的缓存提示、指标可信度与命中诊断
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
`Alt+V`），支持的终端里也可以把图片拖进去。若当前模型不支持图片，扩展会把本轮临时切到
`vision` 路由，回合结束后恢复原模型；因此请把 `vision` 路由指向多模态模型。

## 配置

配置文件为 `.pi/pi-extends.json`（项目级）与 `~/.pi/agent/pi-extends.json`（用户级），
项目级按字段覆盖用户级。示例见 `templates/pi-extends.example.json`，JSON Schema 见 `schemas/pi-extends.schema.json`。

`/config generate` 写文件时会把 `$schema` 算成从 `.pi/` 指向包内 schema 的相对路径；
项目未信任时拒绝写入，已有文件默认不覆盖，确需覆盖时使用 `/config generate --force`。
编辑器就能补全和校验字段。这个值不能写死：schema 在包里（项目级安装时是
`node_modules/pi-extends/schemas/`），配置在 `.pi/`，两者的相对关系取决于装到哪。
指不到的话编辑器不报错，只是静默不校验 —— 所以由 `tests/config.test.ts` 断言那个
路径真的能解析到文件。

配置分块：`theme`、`icons`（图标集）、`border`（卡片边框 round/square/none）、
`currentModel`、`roles`（四角色）、
`routes`（按用途路由）、`providers`（自定义厂商）、`subagents`、`goal`、
`advisor`（旁审开关/等级/上限）、`keywords`（魔法关键词开关）、
`orchestration`（自动分工模式与阈值）、`notifications`（桌面通知）。

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
      "cache": {
        "metrics": "reported",
        "anthropicCacheControl": true,
        "supportsLongRetention": false
      },
      "models": [
        {
          "id": "my-model",
          "name": "My Model",
          "reasoning": false,
          "input": ["text", "image"],
          "contextWindow": 128000,
          "maxTokens": 8192,
          "cost": {
            "input": 1,
            "output": 4,
            "cacheRead": 0.1,
            "cacheWrite": 1.25
          }
        }
      ]
    }
  ]
}
```

配置中只保存 `$MY_LLM_API_KEY` 这类环境变量引用，绝不写入密钥明文。
价格单位是美元 / 百万 token；不填 `cost` 表示价格未知，footer 显示 `?`，不会误报为免费。
`input` 包含 `image` 后，该模型才能被视觉路由识别。

缓存说明：扩展不额外实现一层代理缓存，缓存是否生效仍由实际 provider/中转协议决定。
`cache.metrics` 只描述统计字段是否可信：`reported` 表示中转会可靠返回
`cacheRead/cacheWrite`，`unreported` 表示不会可靠返回，`auto`（默认）采取保守判断。
只有明确确认 OpenAI Completions 兼容中转接受 Anthropic 风格缓存标记时，才打开
`anthropicCacheControl`；这会让 Pi 按该格式发送 `cache_control`，不保证中转一定命中。
`supportsLongRetention` 只声明端点能力；还需设置 `PI_CACHE_RETENTION=long` 才会请求长保留，
否则 Pi 保持默认的短保留策略。footer 收到可信指标后显示命中率，指标不可信时显示 `CH?`。
`/cache` 会进一步列出最近回合：是否能确认 Pi 发出了缓存提示、指标是命中/写入/可信零值
还是未可靠上报，以及对应判断。中转若命中却不返回统计，客户端无法证明，只会明确标为
“可能命中但未回传，无法确认”，不会猜成零命中。

## 开发

```bash
npm install
npm run typecheck   # 类型检查
npm test            # 单元测试（Node 原生 test runner，213 条）
npm run pack:dry    # 打包检查
```

只跑一个文件：`node --test tests/plan-mode.test.ts`。

plan-mode / goal-mode 这类事件驱动扩展没有可直接调用的纯函数，测试走
`tests/helpers/extension-harness.ts`：一个假 pi，把注册进来的命令/事件/工具收进 Map，
由用例主动 emit，断言对着「`setActiveTools` 收到什么、`appendEntry` 落了什么、
`sessionManager` 走的是 `getBranch` 还是 `getEntries`」写。
模块级状态用带查询串的动态 `import` 隔离（`plan-mode.ts?case=N` 每次拿到全新实例），
恢复路径的用例因此可以换一份新实例、只喂 entries，跟真实重启一致。
`npm test` 只匹配 `tests/*.test.ts`，helpers 不会被当成测试文件。

本地冒烟测试：`pi -e ./extensions/pi-extends`，或安装到测试项目后运行 `/cockpit`。

## 安全边界

- Plan 模式拦截 `edit`/`write` 与非只读 bash 命令，并按**解析后的工具集**拦下带写权限的子代理
  （不是按角色名单）：给 `scout` 配上 `edit` 一样会被拦，把 `worker` 改成只读则不再被拦。
  `bash` 也算写权限 —— 父进程的 bash 允许清单是 `tool_call` 钩子，管不到独立的子进程。
- 子代理的工具集始终显式下传给子进程（`--tools`）。未配置 `roles` 时用只读默认值，
  而不是让子进程按 pi 的完整默认工具集启动。
- Goal autopilot 有硬性轮次上限，达到后自动暂停；用户中止时立即暂停。
- 自动分工默认只建议、不改写；答一次「否」之后本会话不再打扰。要它自己动手得显式设成 `auto`。
- 自定义厂商 Base URL 保存前需确认；密钥只通过环境变量提供。
- 桌面通知只走 `pi.exec(command, args[])`（不经 shell），正文先剥 ANSI 与控制字符再截断；默认关闭。
- 配置损坏时回退默认值并给出可理解警告，不阻止 Pi 启动。

前三条由 `tests/plan-mode.test.ts`、`tests/goal-mode.test.ts` 与 `tests/subagent-tools.test.ts`
守住：工具权限的切换与还原、bash 允许清单、autopilot 的四条刹车（轮次上限、plan 模式待批准、
有待处理消息、用户中止）、以及子代理 argv 里 `--tools` 的实际取值各自有用例。

会话状态与用量统计都只认当前分支（`getBranch()`）—— 会话是一棵树，用户 rewind 之后，
按文件顺序取到的最后一条状态 entry 可能属于已被抛弃的那条路，footer 的用量也会把
废弃分支的 token 一起累进去。

## 许可证

MIT。第三方声明见 `THIRD_PARTY_NOTICES.md`。
