/**
 * Local ComfyUI + MiniMax H3 adapter.
 * It deliberately uses ComfyUI's native HTTP API: no cloud video API key,
 * no proxy upload, and no vendor-specific task polling.
 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function comfyBase(config) {
  return String(config.base_url || 'http://127.0.0.1:8188').replace(/\/$/, '');
}

function h3Size(aspectRatio) {
  const ratio = String(aspectRatio || '16:9').replace(/\s/g, '');
  const sizes = {
    '21:9': [1344, 576], '16:9': [1344, 768], '9:16': [576, 1024],
    '1:1': [768, 768], '4:3': [1024, 768], '3:4': [768, 1024],
    '3:2': [1152, 768], '2:3': [768, 1152],
  };
  return sizes[ratio] || sizes['16:9'];
}

function h3Frames(seconds) {
  const frameCount = Math.max(5, Math.round((Number(seconds) || 5) * 24));
  return frameCount + (5 - frameCount % 17) % 17;
}

function h3Workflow({ prompt, duration, aspectRatio, imageName, lastImageName }) {
  const [width, height] = h3Size(aspectRatio);
  const graph = {
    '6': { class_type: 'UNETLoader', inputs: { unet_name: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors', weight_dtype: 'default' } },
    '11': { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_video_vae_fp16.safetensors' } },
    '13': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors', type: 'minimax', device: 'default' } },
    '15': { class_type: 'RandomNoise', inputs: { noise_seed: Math.floor(Math.random() * 9007199254740991) } },
    '16': { class_type: 'BasicGuider', inputs: { model: ['121', 0], conditioning: ['104', 0] } },
    '17': { class_type: 'KSamplerSelect', inputs: { sampler_name: 'res_multistep' } },
    '23': { class_type: 'VAEDecodeAudio', inputs: { samples: ['14', 0], vae: ['24', 0] } },
    '24': { class_type: 'VAELoader', inputs: { vae_name: 'minimax_h3_audio_vae_fp32.safetensors' } },
    '9': { class_type: 'BasicScheduler', inputs: { model: ['121', 0], scheduler: 'simple', steps: 8, denoise: 1 } },
    '10': { class_type: 'VAEDecode', inputs: { samples: ['14', 0], vae: ['11', 0] } },
    '14': { class_type: 'SamplerCustomAdvanced', inputs: { noise: ['15', 0], guider: ['16', 0], sampler: ['17', 0], sigmas: ['9', 0], latent_image: ['104', 1] } },
    '91': { class_type: 'CreateVideo', inputs: { images: ['10', 0], audio: ['23', 0], fps: 24, bit_depth: 8 } },
    '92': { class_type: 'SaveVideo', inputs: { video: ['91', 0], filename_prefix: 'localminidrama/H3', format: 'mp4', codec: 'auto' } },
    '104': { class_type: 'MiniMaxH3ImageToVideo', inputs: { clip: ['13', 0], vae: ['11', 0], prompt: String(prompt || 'cinematic scene'), width, height, length: h3Frames(duration) } },
    '121': { class_type: 'LoraLoaderModelOnly', inputs: { model: ['6', 0], lora_name: 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors', strength_model: 1 } },
  };
  if (imageName) {
    graph['1'] = { class_type: 'LoadImage', inputs: { image: imageName } };
    graph['104'].inputs.first_frame = ['1', 0];
  }
  if (lastImageName) {
    graph['2'] = { class_type: 'LoadImage', inputs: { image: lastImageName } };
    graph['104'].inputs.last_frame = ['2', 0];
  }
  return graph;
}

async function readImageSource(source, storagePath, filesBaseUrl) {
  if (!source) return null;
  const raw = String(source);
  const staticPrefix = String(filesBaseUrl || '').replace(/\/$/, '') + '/';
  let local = raw;
  if (staticPrefix !== '/' && raw.startsWith(staticPrefix)) local = raw.slice(staticPrefix.length);
  local = local.replace(/^\/static\//, '').replace(/^\//, '');
  const candidate = path.resolve(storagePath || '.', local);
  if (storagePath && candidate.startsWith(path.resolve(storagePath)) && fs.existsSync(candidate)) {
    return { buffer: fs.readFileSync(candidate), filename: path.basename(candidate) };
  }
  if (/^https?:\/\//i.test(raw)) {
    const response = await fetch(raw);
    if (!response.ok) throw new Error(`读取参考图失败：HTTP ${response.status}`);
    return { buffer: Buffer.from(await response.arrayBuffer()), filename: `reference-${randomUUID()}.png` };
  }
  throw new Error('找不到本地参考图：' + raw);
}

async function uploadImage(baseUrl, source, storagePath, filesBaseUrl) {
  if (!source) return null;
  const image = await readImageSource(source, storagePath, filesBaseUrl);
  const form = new FormData();
  form.append('image', new Blob([image.buffer]), image.filename);
  form.append('overwrite', 'false');
  const response = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`ComfyUI 图片上传失败：${await response.text()}`);
  const payload = await response.json();
  return payload.name || image.filename;
}

function extractVideo(output) {
  for (const nodeOutput of Object.values(output || {})) {
    const file = [...(nodeOutput.videos || []), ...(nodeOutput.images || [])]
      .find((item) => /\.(mp4|webm|mov)$/i.test(String(item.filename || '')));
    if (file) return file;
  }
  return null;
}

async function generate(config, opts, log) {
  const baseUrl = comfyBase(config);
  const imageName = await uploadImage(baseUrl, opts.first_frame_url || opts.image_url, opts.storage_local_path, opts.files_base_url);
  const lastImageName = await uploadImage(baseUrl, opts.last_frame_url, opts.storage_local_path, opts.files_base_url);
  const response = await fetch(`${baseUrl}/prompt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: h3Workflow({ prompt: opts.prompt, duration: opts.duration, aspectRatio: opts.aspect_ratio, imageName, lastImageName }), client_id: randomUUID() }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.prompt_id) throw new Error(`ComfyUI 提交失败：${payload.error?.message || JSON.stringify(payload)}`);
  const timeoutMs = Math.max(60, Number(config.settings?.timeout_seconds || 1800)) * 1000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const historyResponse = await fetch(`${baseUrl}/history/${encodeURIComponent(payload.prompt_id)}`);
    if (!historyResponse.ok) continue;
    const history = await historyResponse.json();
    const job = history[payload.prompt_id];
    if (!job) continue;
    const status = job.status?.status_str;
    if (status === 'error') throw new Error(`ComfyUI 生成失败：${JSON.stringify(job.status.messages || []).slice(0, 600)}`);
    const video = extractVideo(job.outputs);
    if (video) {
      const query = new URLSearchParams({ filename: video.filename, subfolder: video.subfolder || '', type: video.type || 'output' });
      return { video_url: `${baseUrl}/view?${query}` };
    }
  }
  log.warn('[LocalComfyH3] timeout', { video_gen_id: opts.video_gen_id, prompt_id: payload.prompt_id });
  throw new Error('ComfyUI 生成超时；任务可能仍在 ComfyUI 队列中，请在 ComfyUI 中查看。');
}

module.exports = { generate, h3Size, h3Frames, h3Workflow };
