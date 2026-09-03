# 本机 ComfyUI MiniMax H3

此分支将 LocalMiniDrama 的视频生成器改为本机 ComfyUI API，不使用任何云端视频 API Key。

默认视频配置会自动创建：

- 供应商：`local_comfy_h3`
- ComfyUI：`http://127.0.0.1:8188`
- 模型：MiniMax H3 FL2V + 8-step Turbo LoRA
- 21:9：1344 × 576；16:9：1344 × 768

文本、图片和语音仍是可单独配置的提供方；它们不影响本地 H3 视频生成。视频产物先由 ComfyUI 保存，再自动复制到 LocalMiniDrama 的本地项目素材目录。
