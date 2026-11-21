# skill

个人维护的 DeepSeek Harness 技能与插件集合。

## 目录约定

```
skill/
├── skills/     技能（SKILL.md + references/），由 DSH 的 skill 系统加载
└── plugins/    插件（package.json + cordis.patch.yml），由 DSH 的 plugin 系统加载
```

**技能和插件不是一回事：**

| | skill | plugin |
|---|---|---|
| 本质 | 一段任务说明书 | 一段运行时代码 |
| 加载方式 | 会话开始时注入目录 | 进程启动时挂载入口 |
| 安装位置 | `~/.dsh/skills/<name>/` | DSH profile（`plugin_manager` 或 `dsh plugin add`） |
| 能否卸载 | 删目录即可 | 需要从 profile 移除 |

## skills/

### capcut-launch-tiktok

TikTok 上给 CapCut 拉新的短视频文案与结构方法。核心内容：

- 锚点机制（模板锚点 vs 下载锚点、按钮文字对齐）
- 文案硬规则（每句 4–7 词、动词开头、形容词 ≤ 2、CTA 前置）
- 四段结构（钩子 / 降门槛 / 锚点路径 / 收尾）
- 视频简介四层结构（正文 / 短关键词 / 长尾 / 话题）
- 字幕与箭头实测参数
- BGM 选曲、BPM 匹配、混音电平
- 出片参数与 PP 必踩的坑

安装：把 `capcut-launch-tiktok` 整个目录放到 `~/.dsh/skills/` 下。

### multi-agent-code-review

个人开发者使用的多 Agent 代码审查流程。独立上下文的子 Agent 并行找 Bug、独立验证、安全审查，最多三轮收敛。

安装：同上。

## plugins/

### dsh-video-studio

视频工作台插件。

安装：通过 DSH 的插件管理器挂载，或把 `package.json` 里的包链接进 profile。

## 新增内容时

- 技能 → 新建 `skills/<kebab-case-name>/SKILL.md`，frontmatter 必须含 `name` 和 `description`
- 插件 → 新建 `plugins/<package-name>/`，至少含 `package.json` 和 `cordis.patch.yml`

## 许可

各子目录内自带许可说明。`skills/capcut-launch-tiktok` 与 `skills/multi-agent-code-review` 为自用文档；`plugins/dsh-video-studio` 的许可见其目录内的 `LICENSE`。
