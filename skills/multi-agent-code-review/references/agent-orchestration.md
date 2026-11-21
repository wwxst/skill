# Agent Orchestration — 主 Agent 调度规范

本文件是每次审查都必须读取的强制规则。它解决最关键的问题：主 Agent 是否真的创建多个子 Agent，以及子 Agent 是否按 Skill 执行。

## 1. 先检查宿主能力

主 Agent 必须检查当前运行环境提供的工具或机制，确认是否支持：
- 创建子 Agent / 新 Agent 任务；
- 为每个 Agent 分配独立上下文；
- 并行启动多个 Agent；
- 向 Agent 传入任务指令和必要上下文；
- 等待任务完成并读取返回结果；
- 获取失败、超时或取消状态；
- Agent 之间能否直接发送消息；如果不能，主 Agent 能否把一个 Agent 的问题/证据转发给另一个 Agent 并收回回应；
- 能否让 Agent 在首轮独立审查结束后，针对其他 Agent 的 finding 进行第二阶段交叉质疑。

使用当前平台真实提供的能力。不要假设所有平台的工具名称相同，也不要编造工具调用。

### 能力检查结果

- `MULTI_AGENT_FULL`：可创建独立上下文 Agent、并行调度、回收结果，并支持 Agent 直接沟通或由主 Agent 中转交叉讨论。
- `MULTI_AGENT_MEDIATED`：不能直接 Agent-to-Agent 发消息，但主 Agent 可以把问题和证据转发给其他 Agent，再收回独立回应；可以执行主 Agent 中转式协作。
- `MULTI_AGENT_LIMITED`：可以创建独立 Agent，但不能直接沟通，也不能由主 Agent 中转进行交叉质疑；只能做独立并行审查，缺少协作阶段。
- `MULTI_AGENT_UNAVAILABLE`：没有真实子 Agent 能力，不能执行多 Agent 审查。

**不能因为模型“能够模拟多个角色”，就认定具备多 Agent 能力。**

## 2. 能力不足时必须暂停并告知开发者

在正式审查前完成能力检查。

- 如果不支持创建独立上下文子 Agent：暂停，不开始正式多 Agent 审查。
- 如果能创建 Agent，但不支持并行：说明只能串行执行，询问开发者是否接受。
- 如果能创建 Agent，但不能确认上下文隔离：说明无法保证独立审查，询问是否改用单 Agent 降级。
- 如果不能等待或回收子 Agent 结果：说明无法形成完整审查闭环，暂停并询问开发者。
- 如果不能让 Agent 直接沟通，也不能由主 Agent 中转消息进行交叉质疑：明确说明缺少 Agent 协作能力，并询问开发者是否接受“仅独立并行审查、不做 Agent 交叉讨论”的受限模式，或停止任务。
- 如果开发者同意单 Agent 降级，报告必须标记 `SINGLE_AGENT_FALLBACK`；如果同意仅独立并行审查，标记 `MULTI_AGENT_NO_CROSS_TALK`。不得把受限模式描述成完整的多 Agent 协作审查。

向开发者说明时，用直白语言说清楚：
1. 当前环境具备什么能力；
2. 缺少什么能力；
3. 原计划中哪些 Agent 工作无法执行；
4. 可选择停止、同意单 Agent 降级，或在缺少 Agent 沟通能力时同意仅执行独立并行审查。

未经开发者同意，不得静默降级。

## 3. 主 Agent 必须实际执行的调度动作

具备能力时，主 Agent 必须：

1. 准备本次审查 Brief。
2. 创建 Bug Hunter A、B、C 三个独立 Agent。
3. 尽可能在同一批次并行启动，不要先等 A 完成再启动 B、C。
4. 为每个 Agent 指定不同审查角度和对应规则文件。
5. 收集并确认三个 Agent 的真实完成状态。
6. 汇总候选问题、去重、分配 finding ID。
7. 对每条候选问题创建独立 Voter。
8. 对 High / Critical 或安全敏感变更创建独立 Security Reviewer。
9. 等待首轮 Agent 返回并冻结独立结论。
10. 按 `references/agent-collaboration.md` 组织 Agent 直接沟通或主 Agent 中转式交叉讨论。
11. 收集沟通结果后，再创建 Voter 并进入最终判断。

不得只输出计划而不执行调度。若因工具限制不能启动，应在报告中写明具体限制。

## 4. 每个子 Agent 的输入契约

**不要假定子 Agent 自动继承主 Agent 已读取的 Skill 内容。**

创建子 Agent 时，必须在它的任务指令中明确传入：

- 本次任务目标；
- 子 Agent 的角色和唯一职责；
- 需要审查的 commit / PR / diff 范围；
- 原始需求和验收标准；
- 项目规则文件的位置；
- 必须读取的 Skill 参考文件路径；
- 需要查看的相关源码范围；
- 只读限制；
- 输出格式；
- 明确禁止读取的上下文。

如果 Agent 无法访问 Skill 文件路径，主 Agent 必须把相关规则的必要内容直接放进子 Agent 指令，不能只给一个它打不开的路径。

### 子 Agent 启动模板

```text
你是本次 Multi-Agent Code Review 的独立子 Agent。

你的角色：
{ROLE}

你的唯一任务：
{TASK}

审查范围：
{BASE_COMMIT}...{HEAD_COMMIT}
{DIFF_SCOPE}

任务背景：
{REQUIREMENT_AND_ACCEPTANCE_CRITERIA}

项目规则：
{PROJECT_RULE_FILES}

你必须先读取以下 Skill 规则：
{REQUIRED_SKILL_REFERENCE_FILES}

上下文隔离：
- 不读取开发 Agent 的历史对话、内部推理或自我解释。
- 不读取其他首轮审查 Agent 的结论。
- 在首轮独立审查阶段，不与其他审查 Agent 讨论候选问题。
- 首轮结论提交并冻结后，只有主 Agent 明确启动交叉讨论阶段时，才可以查看被分配给你的其他 Agent finding 并进行质疑。
- 只使用本任务提供的信息和你自己读取的项目源码形成判断。

执行约束：
- 只读审查，不修改文件。
- 不提交、不推送、不合并。
- 只报告有代码证据、可说明触发条件和实际影响的问题。
- 不报告纯风格、格式和无关清理建议。
- 没有发现时明确返回 0 个候选问题。

最终按指定 JSON/Markdown 字段返回结果。
```

## 5. 首轮三个 Bug Hunter 的分工

三个 Agent 必须是独立上下文，互不读取对方结果。

### Agent A — Behavior & Root Cause

必须读取：
- `references/bug-hunting.md`

主要检查：
- 需求是否正确实现；
- 逻辑错误和状态转换；
- Bug 修复是否触及根因；
- 是否破坏已有行为。

### Agent B — Integration & Data Flow

必须读取：
- `references/bug-hunting.md`

主要检查：
- 上下游调用链；
- API、事件、配置和数据结构；
- 模块边界和兼容性；
- 并发、资源生命周期和状态一致性。

### Agent C — Boundary & Failure Paths

必须读取：
- `references/bug-hunting.md`

主要检查：
- 空值、异常、超时、重试和取消；
- 输入边界和权限边界；
- 失败恢复；
- 测试遗漏和测试弱化。

## 6. Voter 的调度

每条候选 finding 默认创建 2 个独立 Voter。

每个 Voter 必须：
- 读取 `references/finding-validation.md`；
- 不读取其他 Voter 的投票；
- 不读取 Bug Hunter 的内部讨论；
- 独立查看候选描述、相关代码、diff、需求和项目规则；
- 输出 `CONFIRM`、`REJECT` 或 `UNCERTAIN`，并给出证据。

两名 Voter 意见不一致时，创建第 3 个独立 Voter。3 人多数作为本 Skill 的默认决策规则；这只是本 Skill 的操作参数，不代表 Anthropic 已公开的内部投票人数。

## 7. Security Reviewer 的调度

High / Critical 或涉及认证、授权、Shell、文件系统、密钥、敏感数据、网络输入、数据隔离、CI/CD 的变更，必须创建独立 Security Reviewer。

它必须读取：
- `references/security-review.md`

它不读取 Bug Hunter 的结论，不修改代码，独立返回安全发现和证据。

## 8. 子 Agent 结果状态

主 Agent 必须记录每个 Agent 的真实状态：

- `COMPLETED`：正常完成并返回结果；
- `FAILED`：执行失败；
- `TIMED_OUT`：超时；
- `CANCELLED`：被取消；
- `NOT_STARTED`：未启动。

失败的 Agent 可以在确认原因后最多重试一次。重试仍失败则标记审查不完整，不得把缺失结果当成“没有问题”。

## 9. 只读和单写者规则

- 所有 Bug Hunter、Voter 和 Security Reviewer 默认只读。
- 只有主 Agent 或明确指定的 Fix Agent 可以在 Review & Fix 模式中修改代码。
- 同一时间只能有一个 Agent 写入当前工作区。
- 如果需要并行修复，必须使用互相隔离的 worktree，并由主 Agent 负责集成；默认不启用并行修复。

## 10. 防止上下文污染

主 Agent 可以向子 Agent 提供需求、diff、架构文档和必要源码；这些是审查所需事实，不属于开发 Agent 的思考历史。

禁止提供：
- 开发 Agent 的完整对话；
- 开发 Agent 对实现方案的自我辩护；
- 其他 Bug Hunter 的发现；
- 其他 Voter 的结论。

首轮审查全部结束后，主 Agent 才能汇总结果并创建 Voter 任务。


## 11. 必须留下可审计的执行记录

主 Agent 必须记录实际发生的动作，而不是原计划：
- Agent 名称或运行环境返回的任务 ID；
- 角色；
- 创建是否成功；
- 启动和完成状态；
- 实际收到的任务范围；
- 实际读取的 Skill 参考文件；
- 返回的候选问题数量；
- 是否失败、超时或重试；
- 主 Agent 如何处理该结果。

如果宿主工具没有提供某个字段，写“平台未提供”，不要编造。
不要把 Agent 的完整内部推理或私有思维链贴给开发者；只汇报任务、检查范围、证据、结论和可验证的执行结果。


## 12. Agent 沟通能力检查与记录

沟通能力分为两种：
- `DIRECT`：子 Agent 可以直接向另一个子 Agent 发送消息。
- `COORDINATOR_RELAY`：子 Agent 不能直接互发消息，但主 Agent 可以转发结构化 finding、问题和回应，形成有记录的交叉讨论。

只要其中一种可用，就可以执行协作阶段；报告必须注明采用哪一种。

如果两种都不可用：
- 不得假装 Agent 之间沟通过；
- 必须向开发者说明缺少直接沟通和主 Agent 中转能力；
- 询问是否接受 `MULTI_AGENT_NO_CROSS_TALK` 受限模式；
- 未获同意前不得静默省略协作阶段。

记录每次沟通：
- 发起 Agent；
- 接收 Agent；
- 讨论的 Finding ID 或问题；
- 提供的代码证据；
- 对方回应；
- 是否导致 finding 更新、撤销或新增检查；
- 最终由主 Agent 如何处理。

不要转发模型私有思维链。只交换可验证的 finding、代码位置、触发条件、影响和问题。


## 13. 禁止提前引用未返回结果

主 Agent 在调度过程中必须把每个 Agent 的真实状态视为唯一事实源。

只有状态为 `COMPLETED` 且已经拿到实际返回内容时，才能：
- 统计该 Agent 的 finding；
- 在报告中概括该 Agent 的结论；
- 把该 Agent 的 finding 交给其他 Agent 质疑或 Voter 验证。

以下状态不能被当作已完成：
- `PENDING`
- `RUNNING`
- `FAILED`
- `TIMED_OUT`
- `CANCELLED`
- `NOT_STARTED`

禁止：
- 根据角色推测某个 Agent 会得出什么结论；
- 根据其他 Agent 的结果代填尚未返回 Agent 的 finding；
- 在 Agent 返回前提前写“该 Agent 也确认了”；
- 因为“结果后来碰巧一致”就忽略提前下结论的问题。

一旦发生，主 Agent 必须：
1. 立即撤回该结论；
2. 等待真实返回或标记失败；
3. 在最终报告中记录为 `PROCESS_ERROR_PREMATURE_RESULT`。

## 14. Agent 执行账本

主 Agent 从第一个子 Agent 创建开始，就必须维护一份执行账本。

每个 Agent 一条记录：

```text
Agent ID:
Role:
Created: YES / NO
Status: PENDING / RUNNING / COMPLETED / FAILED / TIMED_OUT / CANCELLED / NOT_STARTED
Task Scope:
Rules Read:
Findings Produced:
Cross-talk Sent:
Cross-talk Received:
Votes Performed:
Final Contribution:
Retry Count:
Notes:
```

规则：
- Agent ID 使用宿主实际返回的 ID；如果没有，写“平台未提供”，不能伪造。
- Agent 总数只能从账本统计。
- 完成数、失败数、超时数只能从账本统计。
- 每条 finding 必须记录来源 Agent 和阶段。
- 交叉质疑中新产生的 finding，来源写成 `CROSS_TALK`，同时记录提出者。
- Security Review 新 finding，来源写成 `SECURITY_REVIEW`。
- Voter 不算新的 finding 来源，除非它发现了一个独立的新问题；这种情况必须返回主审查阶段重新登记，不能直接悄悄加入总数。

如果报告总数与账本明细不一致，必须先修正报告；无法解释时，标记 `REPORT_INCONSISTENCY`。
