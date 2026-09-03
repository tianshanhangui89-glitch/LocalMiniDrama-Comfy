/**
 * TTS 语音合成服务
 * 支持多种 TTS 接口：minimax、edge-tts（本地）、通用 HTTP
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { spawnSync } = require('child_process');

/**
 * 使用 MiniMax T2A v2 合成语音
 */
async function synthesizeWithMinimax(text, voiceId, apiKey, groupId, model) {
  const body = JSON.stringify({
    model: model || 'speech-02-hd',
    text,
    stream: false,
    voice_setting: {
      voice_id: voiceId || 'female-shaonv',
      speed: 1.0,
      vol: 1.0,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  });
  const url = `https://api.minimax.chat/v1/t2a_v2?GroupId=${groupId}`;
  return new Promise((resolve, reject) => {
    const reqOpts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(urlObj, reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`MiniMax TTS HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
          return;
        }
        const data = JSON.parse(Buffer.concat(chunks).toString());
        if (data.base_resp?.status_code !== 0) {
          reject(new Error(`MiniMax TTS error: ${data.base_resp?.status_msg || 'unknown'}`));
          return;
        }
        const audioHex = data.data?.audio;
        if (!audioHex) { reject(new Error('MiniMax TTS 未返回音频')); return; }
        resolve(Buffer.from(audioHex, 'hex'));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * 使用 OpenAI TTS API 合成语音（兼容所有 OpenAI 格式的代理）
 * POST {base_url}/audio/speech  body: { model, input, voice, response_format, speed }
 */
async function synthesizeWithOpenai(text, voice, apiKey, baseUrl, model, speed) {
  const url = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/audio/speech';
  const body = JSON.stringify({
    model: model || 'tts-1',
    input: text,
    voice: voice || 'alloy',
    response_format: 'mp3',
    speed: speed || 1.0,
  });
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
    };
    const req = mod.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`OpenAI TTS HTTP ${res.statusCode}: ${buf.toString('utf-8').slice(0, 500)}`));
          return;
        }
        resolve(buf);
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('OpenAI TTS 请求超时')); }, 120000);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.write(body);
    req.end();
  });
}

/** Fully offline Chinese TTS baseline.  espeak-ng produces WAV locally and
 * ffmpeg (already used by the project) converts it to the common MP3 output. */
function synthesizeWithLocalEspeak(text, speed) {
  const tempDir = fs.mkdtempSync('/tmp/localminidrama-tts-');
  const wav = path.join(tempDir, 'speech.wav');
  const mp3 = path.join(tempDir, 'speech.mp3');
  try {
    const wordsPerMinute = Math.max(100, Math.min(260, Math.round(175 * Number(speed || 1))));
    const speak = spawnSync('espeak-ng', ['-v', 'zh', '-s', String(wordsPerMinute), '-w', wav, String(text)], { encoding: 'utf8' });
    if (speak.status !== 0) throw new Error((speak.stderr || 'espeak-ng failed').trim());
    const encode = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '128k', mp3], { encoding: 'utf8' });
    if (encode.status !== 0) throw new Error((encode.stderr || 'ffmpeg conversion failed').trim());
    return fs.readFileSync(mp3);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Confucius4-TTS is exposed as a local Gradio app.  Keep the Gradio wire
 * protocol here so the web client never needs direct access to the TTS host. */
async function synthesizeWithConfucius4(text, referencePath, settings = {}, baseUrl = 'http://192.168.1.116:7860') {
  if (!referencePath || !fs.existsSync(referencePath)) throw new Error('请选择有效的 3–10 秒参考音频');
  const base = baseUrl.replace(/\/+$/, '');
  const file = fs.readFileSync(referencePath);
  const ext = path.extname(referencePath).toLowerCase();
  const mime = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.webm': 'audio/webm' }[ext] || 'audio/wav';
  const form = new FormData();
  form.append('files', new Blob([file], { type: mime }), path.basename(referencePath));
  const uploaded = await fetch(`${base}/gradio_api/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(60000) });
  if (!uploaded.ok) throw new Error(`Confucius4 上传参考音频失败（HTTP ${uploaded.status}）`);
  const uploadData = await uploaded.json();
  const remotePath = Array.isArray(uploadData) ? uploadData[0] : (uploadData?.[0]?.path || uploadData?.path);
  if (!remotePath) throw new Error('Confucius4 未返回参考音频路径');

  const call = await fetch(`${base}/gradio_api/call/synthesize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ data: [text, settings.language || '中文', { path: remotePath, meta: { _type: 'gradio.FileData' } }, Number(settings.temperature || 0.8), Number(settings.top_p || 0.8), Number(settings.diffusion_steps || 25)] }),
  });
  if (!call.ok) throw new Error(`Confucius4 提交合成失败（HTTP ${call.status}）`);
  const eventId = (await call.json())?.event_id;
  if (!eventId) throw new Error('Confucius4 未返回合成任务 ID');
  const events = await fetch(`${base}/gradio_api/call/synthesize/${eventId}`, { signal: AbortSignal.timeout(600000) });
  if (!events.ok) throw new Error(`Confucius4 合成请求失败（HTTP ${events.status}）`);
  const sse = await events.text();
  const blocks = sse.split(/\r?\n\r?\n/);
  let result;
  for (const block of blocks) {
    if (/event:\s*complete/.test(block)) {
      const line = block.split(/\r?\n/).find((x) => x.startsWith('data:'));
      if (line) result = JSON.parse(line.slice(5).trim());
    }
    if (/event:\s*error/.test(block)) throw new Error(block.replace(/^.*data:\s*/ms, '').slice(0, 500));
  }
  const audio = Array.isArray(result) ? result[0] : null;
  const remoteUrl = typeof audio === 'string' ? audio : (audio?.url || (audio?.path ? `${base}/gradio_api/file=${encodeURIComponent(audio.path)}` : ''));
  if (!remoteUrl) throw new Error('Confucius4 未返回音频结果');
  const output = await fetch(remoteUrl, { signal: AbortSignal.timeout(120000) });
  if (!output.ok) throw new Error(`下载 Confucius4 音频失败（HTTP ${output.status}）`);
  const contentType = output.headers.get('content-type') || '';
  return { buffer: Buffer.from(await output.arrayBuffer()), extension: contentType.includes('mpeg') ? '.mp3' : (contentType.includes('ogg') ? '.ogg' : '.wav') };
}

/**
 * 合成 TTS 并保存到本地文件
 * @returns {{ local_path: string, audio_url: string }}
 */
async function synthesize(db, log, { text, storyboard_id, config, storage_base, voice_id, speed, reference_path, language, temperature, top_p, diffusion_steps }) {
  if (!text || !text.trim()) throw new Error('text 不能为空');
  const aiConfigService = require('./aiConfigService');
  const ttsConfig = config || (() => {
    const configs = aiConfigService.listConfigs(db, 'tts');
    const active = configs.filter((c) => c.is_active);
    return active.find((c) => c.is_default) || active[0];
  })();
  if (!ttsConfig) throw new Error('未配置 TTS 模型，请在「AI 配置」中添加 service_type=tts 的配置');

  const provider = (ttsConfig.provider || '').toLowerCase();
  let ttsSettings = {};
  try { ttsSettings = JSON.parse(ttsConfig.settings || '{}'); } catch (_) {}
  // 外部传入的 voice_id / speed 优先（海外化场景），否则取配置值
  const voiceId = voice_id || ttsConfig.voice_id || ttsSettings.voice_id || '';
  const groupId = ttsConfig.group_id || ttsSettings.group_id || '';
  const ttsModel = ttsConfig.default_model || (Array.isArray(ttsConfig.model) ? ttsConfig.model[0] : ttsConfig.model) || '';
  const finalSpeed = speed || ttsSettings.speed || 1.0;
  let audioBuffer;
  let outputExtension = '.mp3';

  if (provider === 'minimax') {
    audioBuffer = await synthesizeWithMinimax(
      text,
      voiceId || 'female-shaonv',
      ttsConfig.api_key,
      groupId,
      ttsModel || 'speech-02-hd'
    );
  } else if (provider === 'local_espeak_ng') {
    audioBuffer = synthesizeWithLocalEspeak(text, finalSpeed);
  } else if (provider === 'local_confucius4') {
    const safeRelative = String(reference_path || '').replace(/^[/\\]+/, '');
    const referenceFile = path.resolve(storage_base, safeRelative);
    if (!referenceFile.startsWith(path.resolve(storage_base) + path.sep)) throw new Error('参考音频路径无效');
    const output = await synthesizeWithConfucius4(text, referenceFile, { language, temperature, top_p, diffusion_steps }, ttsConfig.base_url || 'http://192.168.1.116:7860');
    audioBuffer = output.buffer;
    outputExtension = output.extension;
  } else if (provider === 'openai' || ttsConfig.base_url) {
    console.log('==c sxy synthesizeWithOpenai', text, voiceId, ttsConfig.api_key, ttsConfig.base_url, ttsModel, finalSpeed);
    audioBuffer = await synthesizeWithOpenai(
      text,
      voiceId || 'alloy',
      ttsConfig.api_key,
      ttsConfig.base_url,
      ttsModel || 'tts-1',
      finalSpeed
    );
  } else {
    throw new Error(`不支持的 TTS provider: ${provider}，目前支持 openai、minimax`);
  }

  // 保存到本地
  const audioDir = path.join(storage_base, 'audio');
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  const filename = `tts_sb${storyboard_id || 'x'}_${randomUUID().slice(0, 8)}${outputExtension}`;
  const filePath = path.join(audioDir, filename);
  fs.writeFileSync(filePath, audioBuffer);
  const localPath = `audio/${filename}`;
  log.info('[TTS] 合成完成', { storyboard_id, local_path: localPath, provider });
  try { const cs = require('./cloudService'); cs.reportUsage('tts', ttsModel || '', '', 0); } catch (_) {}
  return { local_path: localPath };
}

module.exports = { synthesize };
