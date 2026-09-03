<div align="center">

# 🎬 本地短剧助手

**本地 AI 短剧 & 漫剧生成工具 —— 下载即用，完全开源，数据不出本机**

*LocalMiniDrama · AI-powered short drama creator*

[![version](https://img.shields.io/badge/version-1.2.8-blue?style=flat-square)](https://github.com/xuanyustudio/LocalMiniDrama/releases)
[![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
[![platform](https://img.shields.io/badge/platform-Windows-lightgrey?style=flat-square)](#-快速开始)
[![stack](https://img.shields.io/badge/Vue3%20%2B%20Node.js%20%2B%20Electron-informational?style=flat-square)](#-项目架构)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/xuanyustudio/LocalMiniDrama/pulls)

**[English](docs/en.md) · 简体中文 · [作者故事](docs/story.md)**

[![GitHub](https://img.shields.io/badge/GitHub-xuanyustudio%2FLocalMiniDrama-181717?logo=github&style=flat-square)](https://github.com/xuanyustudio/LocalMiniDrama)
[![Gitee](https://img.shields.io/badge/Gitee-bi__shang__a%2Flocalminidrama-C71D23?logo=gitee&style=flat-square)](https://gitee.com/bi_shang_a/localminidrama)

[**⬇️ 下载 Release**](https://github.com/xuanyustudio/LocalMiniDrama/releases) · [**🚀 快速开始**](#-快速开始) · [**📖 配置 AI**](docs/configuration.md) · [**🗺 画布文档**](docs/plans/2026-06-15-drama-canvas-workflow-plan.md)

</div>

---

## Local AI stack for this deployment

This repository is deployed as an all-local/LAN video-creation stack. Future
agents and maintainers should keep these services local and must not replace
them with paid cloud providers unless explicitly requested.

| Capability | AI config provider | Base URL | Model | Notes |
| --- | --- | --- | --- | --- |
| Voice cloning / TTS | `local_confucius4` | `http://192.168.1.116:7860` | `Confucius4-TTS` | LAN service. A 3–10 second reference voice is recommended; the inference service rejects references longer than 15 seconds. |
| Text generation | `local_llama_qwen3` | `http://127.0.0.1:11435/v1` | `Qwen3-8B-Q5_K_M` | llama.cpp OpenAI-compatible server on the application host. |
| Text-to-image | `local_comfy_zimage` | `http://127.0.0.1:8188` | `Z-Image-Turbo-Local` | Native ComfyUI Z-Image-Turbo workflow. |
| Text/image-to-video | `local_comfy_h3` | `http://127.0.0.1:8188` | `MiniMax-H3-Local` | Native ComfyUI MiniMax H3 workflow. |

### Operating rules for agents

- The application runs on `192.168.1.110`; the web UI is `http://192.168.1.110:5679` and ComfyUI is `http://192.168.1.110:8188`.
- Confucius4-TTS runs on the separate LAN host `192.168.1.116:7860`. It is not a cloud API and needs no API key.
- Start the backend with `LOCAL_ONLY=1`. This hides cloud providers in the AI configuration page and keeps generation on the local stack.
- Do not store API keys for the four providers above. Their `api_key` fields must remain empty.
- Use `127.0.0.1` for Qwen and ComfyUI from the backend host. Do not replace those URLs with the LAN address unless the process topology changes.
- Free creation history and generated media are stored locally in SQLite and `backend-node/data/storage/`.
- The active server copy is `/home/dev/ai-video/LocalMiniDrama-Comfy`. Preserve unrelated user changes and do not reset the worktree.

### Backend start command

```bash
cd /home/dev/ai-video/LocalMiniDrama-Comfy/backend-node
LOCAL_ONLY=1 WEB_DIST_PATH=/home/dev/ai-video/LocalMiniDrama-Comfy/frontweb/dist \
  node src/server.js
```

### Local configuration verification

Open **AI 配置** in the application. The four configurations above should be
active and default for their respective service types. A local provider test
does not require `base_url`/`api_key` fields beyond the URLs listed in the
table. If text/image/video generation fails, check the corresponding local
process first rather than adding a cloud provider.

---

<table>
<tr>
<td width="25%" align="center"><b>🔒 本地优先</b><br/>SQLite + 本地文件，素材不上云</td>
<td width="25%" align="center"><b>🎬 全流程</b><br/>剧本 → 角色/场景 → 分镜 → 视频合成</td>
<td width="25%" align="center"><b>🤖 多模型</b><br/>通义 / 火山 / 可灵 / Gemini 等</td>
<td width="25%" align="center"><b>🗺 双视图</b><br/>列表精细编辑 + 画布批量编排</td>
</tr>
</table>

市面上 AI 短剧工具不少，但真正能**本地离线运行、开箱即用、素材不上云**的几乎没有。  
本项目用纯 JavaScript 从零搭建，接入你自己的 AI API，打开即可生成完整 AI 短剧。

> ✅ 无订阅费 · ✅ 数据本地存储 · ✅ 支持多家 AI 服务商 · ✅ 完全开源可二次开发

---

## 📌 最新动态（v1.2.8）

- 🆕 **Agnes AI 接入**：文本 / 图片 / 视频一键配置，一个 Key 覆盖全流程
- 🆕 **画布模式增强**：剧本节点、右键菜单、浮动工具栏、画布内新建/删除/整集生成
- 🆕 **ModelArk 私有资产库**：SD2 角色认证对接火山方舟资产组，AK/SK 与 Bearer 双鉴权
- 🔧 **图床可配置**：`upload_url` / 超时（默认 180s）/ 重试次数写入 `config.yaml`；缓存 URL 失效自动重传
- 🔧 **提示词优化** · **分镜图片数量上限修复**

完整记录 → **[CHANGELOG.md](CHANGELOG.md)**

---

## 目录

- [界面预览](#-界面预览)
- [核心功能](#-核心功能)
- [快速开始](#-快速开始)
- [AI 服务商](#-ai-服务商支持)
- [项目架构](#-项目架构)
- [后续计划](#-后续计划-roadmap)

---

## 📸 界面预览

<div align="center">
  <img src="项目截图/首页截图.png" alt="首页 · 项目列表" width="960"/><br/>
  <sub>首页 · 项目卡片一览，亮色模式</sub>
</div>

<br/>

<div align="center">
  <img src="项目截图/画布模式.png" alt="画布工作流 · 分镜流水线" width="960"/><br/>
  <sub>🆕 画布模式 · 分镜流水线可视化 · 节点内编辑/生成 · 工作流整组重跑</sub>
</div>

<br/>

<table>
  <tr>
    <td align="center"><img src="项目截图/武侠.png" alt="剧集管理页" width="480"/><br/><sub>剧集管理 · 分集 + 资源库</sub></td>
    <td align="center"><img src="项目截图/武侠分镜.png" alt="分镜编辑页" width="480"/><br/><sub>分镜制作 · 图片 + 视频一键生成</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="项目截图/新版本4宫格分镜.png" alt="角色管理页" width="480"/><br/><sub>角色生成 · AI 自动提取并生成角色形象图</sub></td>
    <td align="center"><img src="项目截图/专业分镜.png" alt="专业分镜参数" width="480"/><br/><sub>分镜制作 · 专业视频参数（景别 / 运镜 / 灯光 / 景深）</sub></td>
  </tr>
  <tr>
    <td align="center" colspan="2"><img src="项目截图/本剧场景库.png" alt="本剧场景库" width="720"/><br/><sub>场景库 · 一键「加入本集」，复用已有场景素材</sub></td>
  </tr>
</table>

---

## 🎬 AI 生成实拍效果

> 以下 3 段视频由**本软件自动工作流选择即梦 1.0**生成，展示连续分镜下角色外貌一致性。

<table>
  <tr>
    <td align="center">
      <video src="项目截图/1.mp4" controls width="300"></video><br/>
      <sub>分镜 1 · 即梦 1.0</sub>
    </td>
    <td align="center">
      <video src="项目截图/2.mp4" controls width="300"></video><br/>
      <sub>分镜 2 · 服装一致</sub>
    </td>
    <td align="center">
      <video src="项目截图/3.mp4" controls width="300"></video><br/>
      <sub>分镜 3 · 人物统一</sub>
    </td>
  </tr>
</table>

> 💡 同时支持火山 **Seedance 2.0**、通义万相、Vidu、可灵 Kling（含 Omni）等，模型越新效果通常越好。

---

## ✨ 核心功能

<details open>
<summary><b>🔄 完整创作流程（点击展开/收起）</b></summary>

| 步骤 | 功能 | 说明 |
|:----:|------|------|
| 1 | **故事生成** | 输入梗概 + 风格，AI 自动生成多集剧本 |
| 2 | **剧本编辑** | 分集管理，剧本文本可自由编辑 |
| 3 | **角色生成** | AI 提取角色列表，逐个生成角色形象图 |
| 4 | **场景生成** | 从剧本自动提取场景，生成场景背景图 |
| 5 | **道具生成** | 从剧本提取/手动添加道具，生成道具图 |
| 6 | **分镜生成** | 按集自动生成分镜脚本（含景别/运镜/台词） |
| 7 | **图片/视频生成** | 逐镜生成静帧图与视频片段 |
| 8 | **合成视频** | 所有分镜视频自动合成为完整剧集文件 |

</details>

<details>
<summary><b>⚡ 一键流水线 · 项目管理 · 分镜编辑</b></summary>

- **一键生成 / 补全并生成**：从角色到合成视频全自动；智能跳过已有内容
- **失败自动重试**：每步最多 3 次，应对限流；实时进度与错误日志
- **工程 ZIP 导出/导入** · **全局素材库** · **16:9 / 9:16 / 1:1 画幅**
- **经典 / 全能分镜** · **`@图片N` 多图参考** · **尾帧衔接** · **导出分镜表 HTML**
- **图片/视频提示词**全文编辑 · 手动上传/拖拽替换参考图

</details>

### 🗺 画布工作流（LibTV 式）

制作页 / 剧集详情 → **画布模式**（`/film/:id/canvas`），与列表模式**同源数据**：

| 能力 | 说明 |
|------|------|
| 竖排流水线 | 每镜一行：经典「文本→首帧/尾帧→视频」；全能「全能分镜词→视频」 |
| 剧本节点 | 画布起点直接编辑剧本、AI 生成故事、提取角色/场景/道具 |
| 节点操作面板 | 单击节点下方编辑/生成，无需频繁切列表 |
| 右键 / 工具栏 | 新建分镜、集、角色、场景、道具；框选创建工作流 |
| 工作流组 | 框选分镜 → 创建工作流 → **整组重跑**（生图/视频/配音可勾选） |
| 布局持久化 | 拖动保存坐标；曲线连线；左键框选、中键/右键平移 |

界面预览见 [上方截图](#-界面预览) · 📖 [画布工作流完整文档](docs/plans/2026-06-15-drama-canvas-workflow-plan.md)

### 🤖 AI 配置 · 🌓 亮/暗主题 · 自定义提示词

三类模型独立配置（图/视频/文本）；一键配置通义/火山；9 类提示词可自定义覆盖。

---

## 🚀 快速开始

### 源码开发

> Node.js ≥ 18

```bash
git clone https://github.com/xuanyustudio/LocalMiniDrama.git
cd LocalMiniDrama

# 后端（端口 5679）
cd backend-node && npm install
cp configs/config.example.yaml configs/config.yaml   # 填入 API Key
npm run migrate && npm start

# 前端（端口 3013，新终端）
cd frontweb && npm install && npm run dev
```

浏览器打开 `http://localhost:3013`，或双击根目录 **`run_dev.bat`** 一键启动。

📖 [详细开发/打包/Docker 指南](docs/quickstart.md) · [AI 配置指南](docs/configuration.md)

---

## 🤖 AI 服务商支持

| 服务商 | 文本 | 图片 | 视频 |
|--------|:----:|:----:|:----:|
| 阿里云 DashScope（通义） | ✅ | ✅ | ✅ |
| 火山引擎 Volcengine（豆包 / Seedance 2.0） | ✅ | ✅ | ✅ |
| 可灵 Kling AI（含 Omni） | — | ✅ | ✅ |
| Agnes AI | ✅ | ✅ | ✅ |
| Google Gemini（Imagen / Veo） | — | ✅ | ✅ |
| Vidu 生数科技 | — | — | ✅ |
| NanoBanana（含代理） | — | ✅ | — |
| 本地 Ollama 等 OpenAI 兼容 | ✅ | — | — |
| 其他 OpenAI 兼容接口 | ✅ | ✅ | — |

---

## 🏗 项目架构

```
LocalMiniDrama/
├── backend-node/     # Express + SQLite，生成/合成/导入导出
├── frontweb/         # Vue 3 + Element Plus + @vue-flow/core
│   └── views/        # FilmList · DramaDetail · FilmCreate · DramaCanvas
├── desktop/          # Electron 打包 exe
└── docs/             # 文档与计划
```

| 层 | 技术 |
|----|------|
| 前端 | Vue 3 · Vite · Element Plus · Pinia · @vue-flow/core |
| 后端 | Node.js · Express · SQLite (better-sqlite3) |
| 桌面 | Electron 28 · electron-builder |

---

## 🗺 后续计划 Roadmap

| 状态 | 计划 | 说明 |
|:----:|------|------|
| ✅ | Seedance 2.0 + 全能模式 | 多图 `@图片N` · `universal_segment_text` |
| ✅ | 画布工作流 | 列表/画布双视图 · 整组重跑 · 节点面板 |
| 📋 | **场景图 → 全景图** | 由场景参考图 AI 扩展超宽/360° 全景，供大景别运镜与场景库 |
| 📋 | 分镜参考图自由上传 | 任意图片作为分镜参考 |
| 📋 | 参考图自由选择 | 生图时手动指定角色/场景参考 |
| 📋 | 宫格图生成视频 | 多帧合图作为视频输入（部分模型已支持） |

> 认领功能或提建议 → [New Issue](https://github.com/xuanyustudio/LocalMiniDrama/issues/new)

<details>
<summary><b>📋 更多历史版本亮点（v1.2.3 及更早）</b></summary>

- **v1.2.3** 分镜解说旁白 · 导出解说 SRT
- **v1.2.2** 连贯帧模式 · 小说/长文导入 · ffmpeg 自动解压
- **v1.2.1** 可灵 Kling · 视频历史版本 · 场景/道具「加入本集」
- **v1.1.x** 多集剧本 · AI 并发 · 四宫格 · 批量生图/视频 …

详见 **[CHANGELOG.md](CHANGELOG.md)**

</details>

---

## 🎯 适合谁

| 用户 | 场景 |
|------|------|
| 📹 内容创作者 | 批量生产 AI 短剧 / 漫剧 |
| 🔒 隐私敏感 | 素材与剧本完全留在本机 |
| 🛠 开发者 | 二次开发、接入新 AI 服务商 |
| 🌱 入门探索 | 低成本体验 AI 视频全流程 |

---

## 📄 License

[MIT](LICENSE)
