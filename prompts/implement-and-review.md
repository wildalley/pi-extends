---
description: 实现并审查（worker → reviewer → worker）
argument-hint: "<需求>"
---
用 subagent 工具的 chain 模式执行三步工作流：

1. worker：完整工具权限，实现需求。
2. reviewer：只读审查，检查缺陷、回归和测试缺口。
3. worker：根据 reviewer 意见修复问题并复验。

将 {previous} 占位符用于把上一步结果传给下一步。最后汇总改动和审查结论。
