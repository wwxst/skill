# 选曲与混音

## 一、先解决版权，再谈选曲

**TikTok 广告用商业歌曲会被 Content-ID 静音或限流。** 三个合法选项：

| 来源 | 授权 | 署名 | 曲库质量 |
|---|---|---|---|
| TikTok 商用曲库（后台内选） | 平台授权 | 不需要 | 高，但受限于平台 |
| incompetech（Kevin MacLeod） | CC BY 4.0 | **需要** | 高 |
| Pixabay / Openverse CC0 | 公共领域 | 不需要 | 中，多为短循环与音效 |

**incompetech 是性价比最高的**：1400+ 首、带 BPM 和风格元数据、可直接下载、CC BY 只需署名。

署名写法：
```
Music: {曲名} — Kevin MacLeod (incompetech.com), CC BY 4.0
```

## 二、选曲流程

1. 取 `https://incompetech.com/music/royalty-free/pieces.json`（约 880KB，含全部曲目元数据）。
2. 按 `feel` / `description` 过滤关键词：
   - 要：upbeat / energetic / electronic / grooving / bright / bouncy / driving / uplifting
   - 排除：waltz / medieval / horror / dark / sad / ambient / drone / christmas
3. BPM 控制在 **110–135**（与 1.3–1.6 秒/句的字幕节奏匹配）。
4. 长度 > 90 秒，避免截取时撞到结尾。
5. 下载：`https://incompetech.com/music/royalty-free/mp3-royaltyfree/{文件名}.mp3`（空格 → `%20`）

## 三、技术筛选指标

| 指标 | 怎么算 | 参考值 |
|---|---|---|
| BPM | onset 包络自相关 | 110–135 |
| 亮度（频谱质心） | 平均 FFT 质心 | **> 2000Hz**（手机喇叭放不出低频，亮度决定可听性） |
| 电平 | RMS | −18 ~ −12 dBFS |

## 四、找最佳片段

10–15 秒的广告不能从曲子开头随便截。做法：

1. 用 onset 通量求每拍能量。
2. 以 60/BPM 为步长，滑窗计算窗口内平均能量。
3. 只考虑**窗口起点对齐到强拍**的位置。
4. 取分数最高者：`score = 窗口均能量 × (0.55 + 0.45 × 起始拍强度)`。
5. 首尾加 50ms / 500ms 淡入淡出。

## 五、混音

| 项 | 值 |
|---|---|
| 音乐整体相对人声 | **−6 dB** |
| 侧链压低 | 人声出现时再压 **6 dB**（快起慢落，30ms 包络） |
| 无旁白段落 | 音乐独自到 −6 dB 相对位，撑住钩子 |
| 母版 | −14 LUFS，True Peak ≤ −1.0 dBTP |

实测参考（14 秒成片）：

| 段 | 电平 |
|---|---|
| 纯音乐开场 | −24.8 dBFS |
| 有旁白段 | −15.7 ~ −18.2 dBFS |

## 六、复查清单

- [ ] 音乐 BPM 与字幕节奏匹配（不是与剪辑节奏匹不匹配）
- [ ] 频谱质心 > 2000Hz
- [ ] 人声段音乐自动让位，听不清人声就是失败
- [ ] 结尾音乐有淡出，不是硬切
- [ ] 授权与署名已确认
