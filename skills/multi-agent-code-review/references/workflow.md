# Workflow — 完整审查工作流

本文件每次审查都必须读取。每次审查还必须读取 `references/agent-collaboration.md` 和 `references/reporting.md`。

## 1. 确认范围并保护工作区

先记录：
- 当前分支和 HEAD；
- 目标基准分支或提交；
- 暂存区、未暂存区和未跟踪文件；
- PR 描述、原始需求和验收标准；
- 是否存在其他会话的未提交修改。

按用户指定的范围生成 diff：
- 单个提交：提交相对父提交；
- 分支：目标基准分支到当前分支；
- PR：PR diff 和 PR 描述；
- 工作区：分别识别 staged、unstaged 和 untracked。

读取存在的项目资料：
- `CLAUDE.md`
- `AGENTS.md`
- `REVIEW.md`
- `CONTRIBUTING.md`
- 变更目录的局部规则
- 相关架构文档和测试说明

保护规则：
- 不执行 `git reset --hard`、`git clean`、强制 checkout；
- 不擅自 stash、rebase、覆盖或删除他人修改；
- 无法区分本次变更和其他会话改动时，先缩小范围或询问用户。

## 2. 先验证开发结果

在运行环境能力检查通过、并获得创建子 Agent 的真实能力后，启动 Bug Hunter 前，主 Agent 应先运行项目现有验证命令：
- 单元测试；
- 集成测试；
- 类型检查；
- Lint；
- 构建；
- 必要的端到端测试；
- UI 变更的截图或实际交互验证。

先读取项目脚本和文档，不要猜命令。

每项记录：
- 实际命令；
- 退出状态；
- 关键输出；
- `PASS` / `FAIL` / `NOT RUN` / `BLOCKED`。

不能把未运行的测试说成通过。基础验证失败时仍可继续审查，但最终结论必须保留失败事实。

## 3. 预审

创建一个全新上下文的 Pre-review Agent：
- 读取需求、验收标准、diff、项目规则和必要源码；
- 不读取开发 Agent 历史对话；
- 独立寻找明显回归、需求遗漏和实现风险；
- 只读，不修改代码。

预审是补充视角，不替代后面的三个并行 Bug Hunter。

## 4. 并行 Bug Hunt

严格按 `references/agent-orchestration.md` 创建三个独立上下文 Bug Hunter；若能力检查未通过，先暂停并询问开发者是否同意降级：
- A：行为正确性和根因；
- B：集成影响和数据流；
- C：边界条件和失败路径。

三个 Agent 同时审查，不共享首轮结论。每个 Agent 必须读取 `references/bug-hunting.md`。

## 5. Agent 交叉沟通

三个 Bug Hunter 首轮结果全部提交并冻结后，按 `references/agent-collaboration.md` 组织 Agent 之间交叉讨论。

优先使用 Agent 直接消息；不支持时由主 Agent 中转 finding 和回应。每条重要 finding 至少接受一名其他 Hunter 的证据质疑或补充检查。

如果两种沟通方式都不支持，必须先向开发者说明并询问是否接受不带交叉沟通的受限模式，不能静默跳过。

## 6. 汇总候选问题

主 Agent 收集三个 Agent 的真实返回和交叉讨论结果。未返回的 Agent 不能被计入完成，也不能提前概括其结论：
- 只处理真实返回的结果；
- 合并相同根因；
- 保留不同触发条件和影响；
- 分配唯一 ID，如 `F-001`；
- 记录来源 Agent 和首次发现轮次；
- 没有候选问题时明确记录 0 个。

## 7. 独立验证

对每条候选 finding，按 `references/finding-validation.md` 创建两个独立 Voter。
- 两票确认：`CONFIRMED`；
- 两票否定：`REJECTED`；
- 意见不一致：增加第三票；
- 三票多数作为默认结果；
- 证据不足：`UNCERTAIN`，不能当成确定 Bug。

投票不能替代主 Agent 对代码证据的最终核对。

## 8. 安全审查

High / Critical 或安全敏感变更必须创建独立 Security Reviewer，并按 `references/security-review.md` 执行。

安全审查结果具有阻断意义。未解决的严重安全问题不能标记为 PASS。

## 9. 发布 Finding

每条确认问题必须包含：
- ID；
- 标题和类别；
- 严重程度；
- 文件路径和行号；
- 代码证据；
- 触发条件；
- 实际影响；
- 是否由本次变更引入；
- 修复建议。

标签：
- `Important`：有明确行为影响、回归或重要风险；
- `Nit`：影响较小但真实、可操作；不能是纯风格偏好；
- `Pre-existing`：本次变更之前已存在，且没有由本次变更引入或扩大。

纯格式、命名偏好、诊断信息和无关清理建议直接过滤。

## 10. 修复和复审

Review Only：只报告，不修改。

Review & Fix：仅修复已验证且属于本次变更的问题。详细规则见 `references/fix-and-convergence.md`。

## 11. 数量一致性检查

输出报告前必须核对：
- Agent 总数是否等于执行账本中真实创建的 Agent 数；
- 完成/失败/超时数是否与账本状态一致；
- finding 总数是否能逐条追溯到来源 Agent 和阶段；
- 交叉沟通新增 finding 是否单独记录；
- Security Review 新增 finding 是否单独记录；
- 被 Voter 排除的问题是否仍保留在“候选问题”统计中但不算“已确认问题”。

不一致时先修正报告；无法解释则标记 `REPORT_INCONSISTENCY`。

## 12. Review Only Git 写保护

Review Only 模式下，最终检查 Git 状态并确认本次审查没有执行 commit、push、merge、rebase、创建 PR 或为保存报告创建提交。

生成本地审查文档不等于获得提交授权。

## 13. 最终验证、执行过程汇报与结论

按 `references/reporting.md` 汇总主 Agent 的工作、每个子 Agent 的任务和结果、finding 处理链、修复和测试。不得只输出一句“审查通过”。

修复后重新运行相关测试，以及必要的完整测试、Lint、类型检查和构建。

最终状态：
- `PASS`：没有未解决阻断问题，必需检查通过；
- `PASS WITH WARNINGS`：没有阻断问题，但有已说明的非阻断风险；
- `FAIL`：有未解决阻断问题或必需检查失败；
- `NEEDS HUMAN`：需要开发者判断需求、架构、不可逆操作或证据不足。

Review Passed 不等于已合并、发布或部署。
