# 出片参数与流程

环境：Windows，ffmpeg 9.0（gyan build），Python 3.13 + Pillow + numpy，剪映 8.9 / 11.8。

## 一、ASS 字幕样式（对齐实测样板）

```ini
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,Arial,55,&H002BA3FF,&H00FFFFFF,&H00FFFFFF,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,2,60,60,180,1
```

要点：
- `PrimaryColour` 是 **ABGR**，橙金 `#FFA32B` 写成 `&H002BA3FF`。
- `Fontsize 55` + `Outline 4`：实测样板字高约 39px（1080×1920 下）。
- `MarginV 180`：距底 180px，贴锚点上沿。**不要用 500+**。
- `BorderStyle 1`（描边无底板）+ `Shadow 0`。
- `Alignment 2`（底部居中）。

字体：`arialbd.ttf` 必须用 `fontsdir` 指定，libass 不会自动找 Windows 字体目录。

## 二、烧字幕 + 混音

```bash
ffmpeg -y -i merged.mp4 -i bgm.wav \
  -vf "subtitles='subs.ass':fontsdir='fonts'" \
  -af "loudnorm=I=-14:TP=-1.5:LRA=9" \
  -map 0:v -map 1:a \
  -c:v libx264 -crf 19 -preset medium -pix_fmt yuv420p -r 30 -fps_mode cfr \
  -c:a aac -b:a 192k -ar 48000 \
  -movflags +faststart out.mp4
```

**必须显式写 `-ar 48000`。** 不加的话 loudnorm 内部跑 192k，输出会变成 96kHz AAC——TikTok 会再转码一次，纯风险无收益。

**True Peak 留 −1.5，不要 0.00。** 顶在天花板的文件在 AAC 解码后会削顶。

## 三、五个必踩的坑

1. **`trange()` 传浮点会被当微秒**（pyJianYingDraft）。必须写 `"1.5s"`。
2. **变速必须放在 `fps` 之前**：`setpts=PTS/1.08` → `fps=30:round=near`，反过来会不规则丢帧。
3. **手操段绝不能镜像**：界面文字会反，教程直接失效。
4. **去重手段要算总倍率**：基础放大 × 推镜 × 裁切填满，三项相乘才是真实倍率。曾叠到 1.47× 把画面裁瞎。
5. **字幕轨道绝对路径**：剪映草稿引用的是磁盘绝对路径，挪动素材目录 = 草稿丢素材。

## 四、文案 → 成片的对齐检查

出片后逐项验：

- [ ] 每句字幕的**实际可见时长**与文案表误差 < 0.15s
- [ ] 相邻句无空档（用 `ffprobe` 抽帧确认没有"无字幕帧"夹在中间）
- [ ] 字幕底边距画面底 175–190px
- [ ] 单句最宽 < 45% 画面宽
- [ ] 左下角锚点区域（约 x 0–380, y 1720–1920）内无任何文字像素
- [ ] 音频 48kHz、TP ≤ −1.0 dBTP

锚点区检测（Python + Pillow）：把成片的左下角矩形裁出来，算非背景像素占比，应接近 0。

## 五、可选：剪映草稿

需要人工续剪时，用 pyJianYingDraft 生成草稿：

```python
track = script.append_track(TrackSpec(TrackType.video))   # 必须先建轨
script.add_segment(seg, track)
```

生成的草稿头（`version: 360000` / `app_version: 5.9.0`）与剪映 8.9 原生一致，可直接打开。
