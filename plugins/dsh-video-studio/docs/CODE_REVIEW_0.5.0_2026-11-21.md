# Video Studio 0.5.0 当前版本复核记录

- 日期：2026-11-21
- 仓库：`wwxst/skill`
- 分支：`feat/auto-video-production`
- 复核基准 HEAD：`a702c11c6a333f1f1c3f5d9c300d679ede3b0fa7`
- PR：[Draft #1](https://github.com/wwxst/skill/pull/1)
- 方式：单 Agent 静态复核 + GitHub Actions Windows/Ubuntu 自动化验证
- 是否创建独立子 Agent：否
- 是否修改 main：否
- 当前结论：**PASS WITH EXTERNAL-INTEGRATION WARNINGS**

## 1. 本轮复核范围

在此前模板与渲染问题复审的基础上，本轮重点检查 0.3–0.5 新增能力：

- Pixabay 搜索、缓存、下载、重定向 allowlist、流式大小限制和文件签名检查。
- 本地素材库 SHA-256 去重、标签、来源元数据和项目导入。
- 图片生成提供方的 HTTPS Base URL、费用确认、返回数据和图片签名校验。
- Storyboard 结构化镜头清单、素材绑定和时间线编译。
- 多画幅复制、批量渲染、失败重试和质量检查。
- TikTok OAuth、账号级 state、redirectUri 校验、令牌刷新和持久化。
- 多账号作品同步、accountId 维度的真实数据记录与汇总。
- Windows / Ubuntu CI、Harness 插件挂载、工具注册和本地工作台安全检查。

## 2. 本轮确认已处理的问题

### 2.1 Pixabay 下载资源控制

- 不再只依赖远端 Content-Length。
- 下载响应按流读取，达到配置上限立即停止，不会先把超大响应完整读入内存。
- 校验图片/视频扩展名与文件头签名，降低把 HTML 或其他错误内容误存为媒体素材的风险。
- 下载地址和重定向目标均检查 HTTPS 域名 allowlist。

### 2.2 素材库一致性

- 相同 SHA-256 内容若以不同媒体 role 再次写入，会明确报错，不会静默复用错误类型。
- 本地文件复制后重新计算 SHA-256，发现复制期间源文件变化会拒绝入库。

### 2.3 TikTok 多账号隔离

- 每个账号使用独立 accountId。
- OAuth state、过期时间、redirectUri、access token、refresh token 和 open_id 按账号保存。
- state 有效期 10 分钟；授权码兑换时校验 state 和原始 redirectUri。
- 多账号令牌写入通过串行队列和唯一临时文件完成，避免并发授权/刷新互相覆盖。
- Display API 请求使用对应 accountId 的令牌；同步 mapping 也按 accountId 找到对应作品。
- 真实发布数据增加 accountId 维度，可按具体账号和账号类型分别汇总。
- 旧版单账号令牌文件会迁移为新账号存储格式。

### 2.4 数据准确性

- API 未提供的收藏、主页访问、关注和转化不会被统计为真实的 0。
- TikTok Display API 只同步实际返回的播放、点赞、评论和分享；其他业务指标仍需从业务后台补录。
- 汇总结果保留样本量，缺少指标时比率返回 null。

## 3. 自动化验证

当前复核 HEAD 的 GitHub Actions：

- [Push CI #44875893182](https://github.com/wwxst/skill/actions/runs/44875893182) — success
- [Pull Request CI #44875898739](https://github.com/wwxst/skill/actions/runs/44875898739) — success

| 环境 | 测试数 | 通过 | 失败 |
|---|---:|---:|---:|
| Windows | 33 | 33 | 0 |
| Ubuntu | 33 | 33 | 0 |

覆盖真实 FFmpeg MP4 渲染、图片运动和文字像素验证、素材库去重、Pixabay 下载安全、TikTok OAuth/分页/刷新/多账号隔离、跨账号端到端同步、批量渲染和质量检查。

## 4. 已知边界，不作为本轮代码缺陷

- Pixabay 真实搜索/下载需要用户自己的 API Key；CI 使用模拟响应验证，不代表用户凭据已验证。
- 图片生成需要兼容 Images API 的 API Key；真实模型、额度和计费取决于用户配置的提供方。每次生成前仍需明确确认费用。
- TikTok 真实同步需要开发者应用获批 Login Kit / Display API 的 `video.list` scope，并由用户授权每个账号。
- TikTok Display API 不提供主页访问、关注、下载、注册或 CPS 转化；这些必须从业务后台导入或手工录入。
- TikTok OAuth 令牌保存在本地 JSON 文件，不做静态加密；POSIX 文件权限设为当前用户，Windows 依赖数据目录 ACL。不要共享或上传令牌文件。
- 当前不支持 TikTok 自动发布、ASR、TTS、CapCut 原生草稿导出、专业级多轨合成和节点调色。
- 自动质量检查是技术辅助检查，不能替代人工审片。
- GitHub CI 通过不等于已在用户 Windows + DeepSeek Harness 本机完成安装、真实 API 授权和实际素材验收。

## 5. 最终状态

- 本轮新增能力复核未发现新的 P1/P2 阻断项。
- Windows 和 Ubuntu 自动化测试均通过。
- 开发分支相对 main：领先 67 个提交、落后 0 个提交。
- PR #1 仍为 Draft，未合并。
- `main` 未修改。
- 外部服务凭据和用户本机 Harness 环境留待一次性实机验收。

本报告不代表第三方账号已授权，也不代表发布/转化数据已接入 CapCut CPS 后台。
