# Finding Validation — 独立问题验证规则

每条候选 finding 都必须经过独立验证，不能因为 Bug Hunter 提出就默认它是真的。

## 1. Voter 上下文隔离

每个候选问题默认创建两个独立上下文 Voter。

Voter 不得读取：
- 开发 Agent 历史对话；
- Bug Hunter 的内部讨论；
- 其他 Voter 的投票；
- 主 Agent 对候选问题的倾向性判断。

Voter 可以读取：
- 候选问题的简短描述；
- 对应代码和行号；
- 必要的完整 diff；
- 原始需求和验收标准；
- 必要的项目规则和上下游源码。

## 2. Voter 必须独立回答

1. 问题是否真实存在？
2. 触发条件是否成立？
3. 是否由本次变更引入或扩大？
4. 实际影响是什么？
5. 代码证据是否充分？
6. 是否只是风格、诊断或清理建议？
7. 是否与已有 finding 重复？

## 3. 默认投票规则

- 两名 Voter 都确认：`CONFIRMED`；
- 两名 Voter 都否定：`REJECTED`；
- 一人确认、一人否定，或任一人标记不确定：创建第三名独立 Voter；
- 三人多数作为本 Skill 默认判断；
- 证据仍不足：`UNCERTAIN`，不得包装成确定 Bug。

本 Skill 的两名初始 Voter 和分歧时第三名 Voter，是为了可执行而设置的默认参数，不代表 Anthropic 已公开的内部投票人数或阈值。

## 4. Finding 分类

- `INTRODUCED`：本次变更引入；
- `REGRESSION`：本次变更破坏已有行为；
- `PRE-EXISTING`：原本就存在，本次没有引入或扩大；
- `UNCERTAIN`：现有证据无法判断。

不能把历史遗留问题归咎于本次变更。

## 5. 主 Agent 最终核对

投票不是事实本身。主 Agent 必须重新核对：
- 文件和行号是否正确；
- 代码证据是否支持结论；
- 触发条件是否真实；
- 影响是否被夸大；
- 是否需要修正严重程度。

## 6. Voter 输出格式

```text
Finding ID:
Vote: CONFIRM / REJECT / UNCERTAIN
Evidence:
Trigger Valid: YES / NO / UNCERTAIN
Introduced By Change: YES / NO / UNCERTAIN
Actual Impact:
Reason:
```
