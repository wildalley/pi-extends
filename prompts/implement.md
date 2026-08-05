---
description: 完整实现工作流（scout → planner → worker）
argument-hint: "<需求>"
---
用 subagent 工具的 chain 模式执行三步工作流：

1. scout：只读侦察，定位相关文件与现有实现。
2. planner：只读规划，输出带 "Plan:" 标题的编号步骤。
3. worker：完整工具权限，按计划实现并验证。

将 {previous} 占位符用于把上一步结果传给下一步。实现完成后总结改动。
