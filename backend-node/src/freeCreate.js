const path = require('path');
const response = require('../response');
const { generateText } = require('../services/aiClient');
const { synthesize } = require('../services/ttsService');
const fs = require('fs');
const uploadService = require('../services/uploadService');

function storagePath(cfg) { const p = cfg.storage?.local_path || './data/storage'; return path.isAbsolute(p) ? p : path.join(process.cwd(), p); }

function routes(db, cfg, log) {
  async function createText(req, res) {
    const prompt = String(req.body?.prompt || '').trim();
    if (!prompt) return response.badRequest(res, '请输入文本提示词');
    const now = new Date().toISOString();
    const info = db.prepare('INSERT INTO free_creations (type, prompt, status, parameters, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('text', prompt, 'processing', JSON.stringify(req.body?.parameters || {}), now, now);
    try {
      const output = await generateText(db, log, 'text', prompt, '你是中文短剧创作助手。请直接输出可用内容，不要解释。', { temperature: Number(req.body?.temperature) || 0.7 });
      const done = new Date().toISOString();
      db.prepare('UPDATE free_creations SET status = ?, output_text = ?, completed_at = ?, updated_at = ? WHERE id = ?').run('completed', output, done, done, info.lastInsertRowid);
      response.success(res, { id: info.lastInsertRowid, type: 'text', status: 'completed', output_text: output });
    } catch (err) { db.prepare('UPDATE free_creations SET status = ?, error_msg = ?, updated_at = ? WHERE id = ?').run('failed', err.message, new Date().toISOString(), info.lastInsertRowid); response.internalError(res, err.message); }
  }
  async function createAudio(req, res) {
    const text = String(req.body?.text || req.body?.prompt || '').trim();
    if (!text) return response.badRequest(res, '请输入配音文本');
    const now = new Date().toISOString();
    const info = db.prepare('INSERT INTO free_creations (type, prompt, status, parameters, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('audio', text, 'processing', JSON.stringify({ speed: req.body?.speed || 1 }), now, now);
    try {
      const result = await synthesize(db, log, { text, storyboard_id: `free_${info.lastInsertRowid}`, storage_base: storagePath(cfg), speed: req.body?.speed, reference_path: req.body?.reference_path, language: req.body?.language, temperature: req.body?.temperature, top_p: req.body?.top_p, diffusion_steps: req.body?.diffusion_steps });
      const done = new Date().toISOString();
      db.prepare('UPDATE free_creations SET status = ?, output_path = ?, completed_at = ?, updated_at = ? WHERE id = ?').run('completed', result.local_path, done, done, info.lastInsertRowid);
      response.success(res, { id: info.lastInsertRowid, type: 'audio', status: 'completed', local_path: result.local_path, url: '/static/' + result.local_path });
    } catch (err) { db.prepare('UPDATE free_creations SET status = ?, error_msg = ?, updated_at = ? WHERE id = ?').run('failed', err.message, new Date().toISOString(), info.lastInsertRowid); response.internalError(res, err.message); }
  }
  function listVoices(req, res) {
    const root = path.join(storagePath(cfg), 'voice-references');
    const collect = (folder, kind) => {
      const dir = path.join(root, folder);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((name) => /\.(wav|mp3|m4a|ogg|webm)$/i.test(name)).map((name) => ({
        id: `${folder}/${name}`, label: path.basename(name, path.extname(name)), kind, path: `voice-references/${folder}/${name}`, url: `/static/voice-references/${folder}/${name}`,
      }));
    };
    response.success(res, [...collect('presets', 'preset'), ...collect('uploads', 'upload')]);
  }
  function uploadVoice(req, res) {
    if (!req.file?.buffer) return response.badRequest(res, '请选择参考音频');
    try {
      const result = uploadService.uploadFile(storagePath(cfg), '', log, req.file.buffer, req.file.originalname || 'voice.wav', req.file.mimetype, 'voice-references/uploads');
      response.success(res, { id: result.local_path, label: path.basename(req.file.originalname, path.extname(req.file.originalname)), kind: 'upload', path: result.local_path, url: `/static/${result.local_path}` });
    } catch (err) { response.internalError(res, err.message); }
  }
  function list(req, res) {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const own = db.prepare('SELECT id, type, prompt, status, output_text, output_path, error_msg, created_at, completed_at FROM free_creations ORDER BY id DESC LIMIT ?').all(limit).map(x => ({ ...x, url: x.output_path ? '/static/' + x.output_path : null }));
    const images = db.prepare("SELECT id, 'image' type, prompt, status, image_url, local_path, error_msg, created_at, completed_at FROM image_generations WHERE deleted_at IS NULL AND (drama_id IS NULL OR drama_id = 0) AND storyboard_id IS NULL ORDER BY id DESC LIMIT ?").all(limit).map(x => ({ ...x, url: x.local_path ? '/static/' + x.local_path : x.image_url }));
    const videos = db.prepare("SELECT id, 'video' type, prompt, status, video_url, local_path, error_msg, created_at, completed_at FROM video_generations WHERE deleted_at IS NULL AND (drama_id IS NULL OR drama_id = 0) AND storyboard_id IS NULL ORDER BY id DESC LIMIT ?").all(limit).map(x => ({ ...x, url: x.local_path ? '/static/' + x.local_path : x.video_url }));
    response.success(res, [...own, ...images, ...videos].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit));
  }
  return { createText, createAudio, list, listVoices, uploadVoice };
}
module.exports = routes;
