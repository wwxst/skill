# Video Studio

Video Studio adds local video-production tools to DeepSeek Harness. The agent can create projects, import media, inspect assets, build an editable timeline, save SRT subtitles, add music or voiceover tracks, and submit FFmpeg rendering jobs.

## Capabilities

- Import and manage video, image, and audio assets
- 9:16, 16:9, 1:1, and custom output dimensions
- Ordered clips, source in/out points, playback speed, crop or contain fitting
- Background music and voiceover mixing
- SRT sidecars and optional burned-in subtitles
- Background render jobs with progress and cancellation
- MP4 preview and persistent project data

## Current limits

Automatic speech recognition, AI voice synthesis, automatic shot selection, advanced transitions, node-based grading, template marketplace, and native CapCut draft export are not included yet. Supply SRT text and import audio files for subtitles and voice tracks. The project stores an editable timeline JSON for future extensions.

Requires Node.js 24.9+, FFmpeg 7+, and FFprobe 7+. Processing is local and source files are never modified.
