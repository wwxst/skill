# Multi-Agent Code Review — 个人开发者版

这是唯一的个人开发者版本，不包含团队审批模式。

它的重点不是简单告诉 AI “请多 Agent 审查”，而是强制主 Agent 在运行环境支持时，真实创建独立上下文的子 Agent，并给每个子 Agent 传递明确任务和 Skill 规则。

## 目录

```text
multi-agent-code-review/
├── SKILL.md
├── README.md
├── references/
│   ├── agent-orchestration.md
│   ├── agent-collaboration.md
│   ├── workflow.md
│   ├── bug-hunting.md
│   ├── finding-validation.md
│   ├── security-review.md
│   ├── fix-and-convergence.md
│   └── evaluation.md
└── templates/
    ├── REVIEW.template.md
    ├── REVIEW_EVAL.template.md
    └── review-report.md
```

## 关键机制

1. 每次审查必须读取 `SKILL.md`、`references/agent-orchestration.md`、`references/agent-collaboration.md`、`references/workflow.md` 和 `references/reporting.md`。
2. 主 Agent 必须检查宿主环境是否真的支持子 Agent。
3. 支持时，默认真实创建 3 个独立上下文 Bug Hunter 并行工作。
4. 每个子 Agent 都必须收到角色、任务、diff、需求、项目规则、必须读取的 Skill 参考文件和输出格式。
5. 不假设子 Agent 自动继承主 Agent 的 Skill 上下文；必须显式传递规则。
6. 首轮独立审查结束后，Agent 通过直接消息或主 Agent 中转交叉质疑和补充检查；每条候选问题再交给独立 Voter 验证，意见不一致时增加第三个。
7. High / Critical 或安全敏感变更启动独立 Security Reviewer。
8. 默认只审查；用户明确授权后才修复。
9. 最多三轮复审，后续只看新增 diff。

## 调用提示词：只审查

```text
使用 multi-agent-code-review Skill 审查当前分支相对 main 的本次变更。

必须按照 SKILL.md 和 references/agent-orchestration.md 执行：
- 检查运行环境是否支持真正的 Subagent；
- 支持时，真实创建 3 个独立上下文的 Bug Hunter 并行审查；
- 每个子 Agent 必须读取它对应的 Skill 参考文件，并收到完整任务、diff 范围和输出格式；
- 等待所有子 Agent 返回，冻结首轮结论；
- 组织 Agent 之间直接沟通或主 Agent 中转式交叉讨论；
- 再创建独立 Voter 验证候选问题；
- 高风险或安全敏感变更执行独立 Security Review；
- 最多三轮，后续只检查新增 diff；
- 默认只审查，不修改代码。

如果环境不支持真实的独立子 Agent，或既不能直接沟通也不能由主 Agent 中转交叉讨论，必须先向开发者说明缺少的能力并询问是否接受受限模式；不得静默跳过或假装完成。

最后使用 templates/review-report.md 输出报告。
```

## 调用提示词：审查并修复

```text
使用 multi-agent-code-review Skill，进入 Review & Fix 模式。

必须真实创建独立上下文的子 Agent，按 Skill 规则并行审查和独立验证。
只修复经过验证、且由本次变更引入或扩大的问题。
修复根因并补充回归测试。
最多三轮；第三轮仍未收敛就停止并报告。
不要 commit、push、merge、部署或操作生产数据。

如果环境不支持真实子 Agent，必须如实说明，不得伪称完成。
```

## 安装

把整个目录放进 Agent 平台支持的 Skill 目录。具体路径按平台要求决定。

项目根目录可按需复制：
- `templates/REVIEW.template.md` → `REVIEW.md`
- `templates/REVIEW_EVAL.template.md` → `REVIEW_EVAL.md`

## 重要说明

- Skill 是流程规范，不会凭空给运行环境增加 Subagent 能力。
- 是否能真实创建 Agent，取决于当前 Agent 平台提供的工具。
- 如果不能创建，必须报告降级，不得假装创建。
- Anthropic 没有公开内部 Bug Hunter 数量和投票阈值。本 Skill 的 3 个 Hunter、2 个初始 Voter 是明确标注的本 Skill 默认参数。
- 默认只审查；修复、提交、推送、合并和发布按用户明确授权执行。


## 执行过程透明汇报

最终报告不仅给 PASS / FAIL，还必须概述：
- 主 Agent 做了哪些工作；
- 创建了哪些子 Agent、各自负责什么；
- 每个 Agent 实际检查的范围、读取的规则和工作结果；
- 每条问题由谁发现、谁验证、怎么修复、如何复测；
- 哪些测试通过、失败或没有运行；
- 还有哪些风险需要开发者知道。

如果运行环境不支持真正的独立子 Agent，必须先说明能力缺口并询问是否同意降级，不得假装创建。


## Agent 之间的沟通

本 Skill 要求“先独立审查，再交叉沟通”：
- 首轮各自独立找问题，不提前看其他 Agent 的结论；
- 首轮结束后，Agent 可以直接互发消息；
- 如果平台不支持直接消息，主 Agent 必须中转问题和回应；
- 两种方式都不支持时，必须告知开发者并征求是否接受受限模式。


## 实跑后新增的三条硬规则

1. **禁止提前写子 Agent 结论。** Agent 没有真实返回前，只能写等待中、失败、超时等真实状态。
2. **Agent 和 Finding 都必须有执行账本。** 最终数量必须能从逐项清单算出来，不能手填。
3. **Review Only 禁止 Git 写操作。** 即使只是审查报告，也不能自动 commit / push / 开 PR；必须有用户明确授权。
