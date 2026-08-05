---
description: 侦察并制定实施计划（scout → planner）
argument-hint: "<需求>"
---
先用 scout 子代理侦察代码库，再用 planner 子代理输出可执行计划。

调用 subagent 工具的 chain 模式，两个步骤：

1. scout：定位相关文件、调用关系和现有实现，返回压缩后的发现。
2. planner：综合侦察结果，输出带 "Plan:" 标题的编号步骤计划（只读，不修改文件）。

请勿在规划阶段使用 worker。产出计划后，等待用户批准再执行。
