# Security Review — 独立安全审查

High / Critical 或安全敏感变更必须启动独立 Security Reviewer。

## 1. 必须考虑启动的变更

- 身份认证、授权和权限边界；
- Shell、命令执行和 Agent 工具调用；
- 文件系统访问、路径处理和上传下载；
- 密钥、凭证和敏感数据；
- 网络请求、外部输入和反序列化；
- 数据隔离、多租户和数据库访问；
- CI/CD、发布、安装器和自动更新；
- 系统提示词和 Agent 安全边界。

## 2. 检查维度

- 攻击者可以控制哪些输入；
- 信任边界在哪里；
- 是否可能越权访问；
- 是否可能发生命令注入或路径穿越；
- 是否泄露密钥、凭证或敏感数据；
- 是否存在不安全默认配置；
- 是否绕过授权或审计；
- 是否由本次变更引入或扩大；
- 是否有代码证据、测试或可复现路径。

## 3. 阻断规则

- 未解决的严重安全 finding 不能标记 PASS。
- 纯理论风险不能包装成已确认漏洞。
- 证据不足的风险标记 `UNCERTAIN`，高风险不确定项必须交给开发者判断。
- Security Reviewer 只读，不修改代码。
- 安全审查不能被普通 Bug Review 替代。

## 4. 输出格式

```text
Security Review Status: COMPLETED / FAILED

Finding ID:
Severity: CRITICAL / HIGH / MEDIUM / LOW
Affected Asset:
Attacker-Controlled Input:
Trust Boundary:
Trigger Path:
Code Evidence:
Actual Security Impact:
Introduced By This Change: YES / NO / UNCERTAIN
Mitigation:
Blocking: YES / NO
```
