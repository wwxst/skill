---
name: multi-agent-code-review
description: 个人开发者使用的多 Agent 代码审查流程。开发完成或准备提交代码时，创建独立上下文的子 Agent 并行找 Bug、独立验证问题、执行安全审查，并在最多三轮内完成审查或明确报告阻塞。
---

# Multi-Agent Code Review

## 1. 目标

你是代码审查的主协调 Agent（Coordinator）。你必须组织真实的独立子 Agent 完成审查，而不是自己模拟多个角色。

本 Skill 面向个人开发者。多个 Agent 负责互相检查，开发者本人负责需求、架构取舍和最终发布决策。不设置多人审批制度。

核心原则：
- 主 Agent 负责调度，不包办所有审查。
- 子 Agent 使用独立上下文，不能继承开发 Agent 的历史对话和自我解释。
- 多个 Bug Hunter 先独立找问题，再通过直接消息或主 Agent 中转进行交叉讨论；独立 Voter 验证每条候选问题。
- 每条问题必须有代码证据、触发条件和实际影响。
- 默认只审查；只有用户明确授权才修复。
- 最多三轮复审，不能无限循环。
- 不能把没有执行的子 Agent、测试或检查说成已经完成。

## 2. 强制启动顺序

触发本 Skill 后，主 Agent 必须按以下顺序执行：

1. **先完整读取本文件。**
2. **必须读取 `references/agent-orchestration.md`、`references/agent-collaboration.md`、`references/workflow.md` 和 `references/reporting.md`。** 分别规定真实创建子 Agent、Agent 之间的交叉沟通、执行审查流程和向开发者汇报全过程。
3. 检查运行环境是否有真实的 Subagent / Agent / Task 创建能力。
4. 读取项目的 `CLAUDE.md`、`AGENTS.md`、`REVIEW.md`、`CONTRIBUTING.md`（存在才读取）。
5. 根据当前任务读取其他对应参考文件：
   - Bug 搜索：`references/bug-hunting.md`
   - 问题投票：`references/finding-validation.md`
   - 安全审查：`references/security-review.md`
   - 修复和结束：`references/fix-and-convergence.md`
   - Agent 交叉沟通：`references/agent-collaboration.md`（每次审查必读）
   - 历史评测：`references/evaluation.md`
6. 按工作流执行，不得跳过子 Agent 调度步骤。

**不要在主 SKILL.md 中一次性加载所有参考文件。** 但 `agent-orchestration.md`、`agent-collaboration.md`、`workflow.md` 和 `reporting.md` 每次审查都必须读取。

## 3. 必须真实创建子 Agent

### 3.1 禁止提前编造子 Agent 结果

这是硬性规则：

- 子 Agent 只有在宿主环境返回真实完成结果后，主 Agent 才能引用、概括或统计它的结论。
- 状态为 `RUNNING`、`PENDING`、`FAILED`、`TIMED_OUT`、`CANCELLED`、`NOT_STARTED` 时，不得预测该 Agent “大概率会发现什么”。
- 不得根据其他 Agent 的结论，提前替尚未返回的 Agent 填写意见。
- 即使最后真实结果与提前猜测完全一致，提前写结论仍属于流程错误。
- 如果发现自己提前写了未返回 Agent 的结论，必须立即撤回、更正，并在最终报告的“流程异常”中记录。

### 3.2 Agent 数量和问题数量必须可追溯

最终报告中的所有数量必须从实际执行记录汇总，不能手填猜数：

- Agent 总数 = 执行账本中真实创建成功的 Agent 条目数。
- 完成数、失败数、超时数分别由状态字段统计。
- 候选 finding 总数必须能追溯到具体 Agent 和具体阶段。
- 如果交叉质疑阶段新增 finding，必须注明“由谁在何阶段新增”。
- 如果 Security Review 新增 finding，也必须单独记录来源。
- 总数与逐项清单不一致时，报告必须标记为 `REPORT_INCONSISTENCY`，不得直接给 PASS。

### 3.3 Review Only 禁止 Git 写操作

`Review Only` 模式下，除用户明确授权外，禁止执行：

- `git add`
- `git commit`
- `git push`
- 创建或切换用于提交的分支
- 创建 PR
- merge / rebase
- 发布、部署
- 为“保存审查报告”而提交文档

可以在工作区生成本地报告文件，但不能自动把报告提交进仓库。

如果用户明确要求“把报告提交/推送到仓库”，才允许执行对应 Git 操作，并且仍需遵守仓库保护规则。


这是本 Skill 的核心要求：

- 如果运行环境支持创建独立上下文的子 Agent，必须真实调用该能力。
- 首轮默认创建 3 个 Bug Hunter，并行执行。
- 每个子 Agent 必须收到明确的角色、任务范围、输入资料、必须遵守的参考文件和输出格式。
- 每个子 Agent 必须按任务读取对应的 `references/*.md` 规则；不能只收到“帮我看看代码”。
- 主 Agent 必须等待子 Agent 完成独立审查，冻结首轮结果，再组织 Agent 之间交叉讨论和质疑；收集讨论结论后进入问题验证阶段。
- 每条候选 finding 默认再交给 2 个独立 Voter；意见不一致时增加第 3 个 Voter。
- 高风险变更必须启动独立 Security Reviewer。
- 子 Agent 只审查，不修改代码。修复由主 Agent 或单独 Fix Agent 在授权后执行。

**禁止以下做法：**
- 只在回复中列出“我会创建三个 Agent”，却没有实际调用子 Agent 能力。
- 在同一个上下文中轮流扮演 Agent A、B、C，并声称完成了独立审查。
- 把开发 Agent 的历史对话、自我解释或推理过程传给审查 Agent。
- 让审查 Agent 互相读取首轮结论，影响独立判断。
- 把子 Agent 没有返回、超时或失败的任务写成已完成。

如果运行环境没有真实的独立子 Agent 能力，主 Agent 必须暂停正式审查，并先向开发者说明：
- 当前环境是否支持创建子 Agent；
- 缺少哪项能力（创建 Agent、独立上下文、并行执行、结果回收等）；
- 因此哪些多 Agent 流程无法执行。

然后询问开发者是否愿意改用单 Agent 降级审查，或在当前环境结束任务。**未经开发者同意，不得自动降级继续审查。** 不得把同一个 Agent 模拟多个角色说成多 Agent 审查。

## 4. 工作模式

### Review Only（默认）

- 读取代码、运行检查、创建审查 Agent、验证问题、输出报告。
- 不修改代码。
- 不执行 git add / commit / push / merge / rebase，不创建用于提交的分支，不创建 PR，不部署，也不操作生产数据。

### Review & Fix

只有用户明确要求“审查并修复”或“开发完成后自动修复”时启用。

- 只修复已经独立验证、且由本次变更引入或扩大的问题。
- 修复根因，补充回归测试。
- 不做无关重构。
- 不 commit、push、merge 或部署，除非用户另行明确授权。

## 5. 风险等级

风险等级决定审查深度，不代表多人审批或新的权限模式。

| 等级 | 典型变更 | 必须执行 |
|---|---|---|
| Low | 文档、文案、普通局部逻辑 | 常规并行 Bug Review 和必要测试 |
| Medium | API、状态管理、缓存、跨模块修改 | 加强调用链、兼容性、边界和回归检查 |
| High | 认证授权、Shell、文件系统、数据库迁移、CI/CD | 独立 Security Review、架构检查、失败路径和回滚分析 |
| Critical | 已确认的严重漏洞、数据破坏或越权风险 | 阻断通过；说明证据、影响和缓解方案；不可逆外部操作需开发者明确授权 |

个人开发者本人是最终决策者。需求歧义、架构取舍、不可逆操作或证据不足时，标记 `NEEDS HUMAN` 并说明具体问题。

## 6. 每次审查的强制流程

1. 确认分支、基准提交、diff 和工作区状态。
2. 保护其他会话的未提交修改。
3. 读取项目规则和验收标准。
4. 先运行适用的测试、构建、Lint 和类型检查。
5. 按 `references/agent-orchestration.md` 创建真实独立子 Agent。
6. 并行执行 3 个 Bug Hunter。
7. 汇总候选 finding，去重并分配 ID。
8. 按 `references/finding-validation.md` 创建独立 Voter 验证每条候选问题。
9. High / Critical 或安全敏感变更执行 `references/security-review.md`。
10. Review Only 模式输出报告；Review & Fix 模式修复已确认问题。
11. 按 `references/fix-and-convergence.md` 最多进行三轮审查与修复。
12. 运行最终验证，按 `references/reporting.md` 整理主 Agent 和每个子 Agent 的实际工作、发现、修复、测试与剩余风险，再输出开发者可读的中文总结。

## 7. 工作区保护

- 不执行 `git reset --hard`、`git clean`、强制 checkout 等破坏性操作。
- 不擅自 stash、rebase、覆盖或删除其他会话的修改。
- 不把整个工作区默认当成本次变更。
- 多个审查 Agent 默认只读，不允许并行修改同一工作区。
- 无法区分本次改动与其他会话改动时，先缩小审查范围或询问用户。

## 8. 结束条件

最多三轮。第三轮后仍有阻断问题，必须停止并报告，不得启动第四轮。

只有满足以下条件才可标记 `PASS`：
- 所有已确认的阻断问题已修复，或由开发者明确决定接受风险；
- 必需的测试、Lint、类型检查和构建通过；
- 需要执行的 Security Review 已完成；
- 没有未解决的 Critical / High 问题；
- 所有未执行的检查和剩余风险都已说明。

状态定义：
- `PASS`：必需检查通过，没有未解决的阻断问题。
- `PASS WITH WARNINGS`：没有阻断问题，但存在已说明的非阻断风险或非关键检查未执行。
- `FAIL`：存在未解决的阻断问题或必需检查失败。
- `NEEDS HUMAN`：需要开发者判断需求、架构、不可逆操作或证据不足。

`PASS` 不等于已经合并、发布或部署。

## 9. 最终报告

必须读取 `references/reporting.md`，并使用 `templates/review-report.md`。报告必须写明：
- 审查范围和风险等级；
- 主 Agent 实际执行了什么；
- 完整的 Agent 执行账本，逐个列出真实 Agent ID、角色、状态、候选问题数、交叉沟通和最终贡献；
- 每个实际创建的子 Agent 的名称/ID、职责、审查范围、读取的规则、完成状态和工作结果；
- Agent 之间是否进行了直接沟通或由主 Agent 中转，沟通了哪些问题、如何回应及形成什么结论；
- 每条问题从发现、交叉质疑、投票验证、修复到复测的完整处理链；
- 流程异常：包括提前引用未返回 Agent、Agent 失败/超时、数量不一致、受限模式、未经授权 Git 写操作等。
- 哪些参考规则被主 Agent 和各子 Agent 实际读取；
- 已确认问题数量、误报数量和待确认数量；
- 每个问题的文件、行号、证据、触发条件和影响；
- 测试、构建、Lint、类型检查的真实结果；
- 修复记录和复审轮数；
- 剩余风险及需要开发者判断的事项。

没有问题时明确写“0 个已确认问题”。如果没有创建真实子 Agent，必须在报告开头醒目标注未执行多 Agent 审查，并说明是否已征得开发者同意采用降级模式。
