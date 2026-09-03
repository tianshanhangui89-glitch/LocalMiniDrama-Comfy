const path = require('path');
const response = require('../response');
const { generateText } = require('../services/aiClient');
const { synthesize } = require('../services/ttsService');
const fs = require('fs');
const uploadService = require('../services/uploadService');
const { randomUUID } = require('crypto');
const { spawnSync } = require('child_process');

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
    finally {
      const root = path.resolve(storagePath(cfg)); const rel = String(req.body?.reference_path || '');
      if (rel.startsWith('voice-references/temp/')) { const f = path.resolve(root, rel); if (f.startsWith(root + path.sep)) { try { fs.unlinkSync(f); } catch (_) {} } }
    }
  }
  function listVoices(req, res) {
    const root = path.join(storagePath(cfg), 'voice-references');
    const collect = (folder, kind) => {
      const dir = path.join(root, folder);
      if (!fs.existsSync(dir)) return [];
      const labels = { xiaoxin: '龙安小昕', huan: '龙安欢', lufeng: '龙安鲁风', paopao: '龙泡泡' };
      return fs.readdirSync(dir).filter((name) => folder !== 'presets' || /^[a-z0-9_-]+_ref\.wav$/i.test(name)).map((name) => ({
        id: `${folder}/${name}`, label: labels[path.basename(name, path.extname(name)).replace(/_ref$/, '')] || path.basename(name, path.extname(name)), kind, path: `voice-references/${folder}/${name}`, url: `/static/voice-references/${folder}/${name}`,
      }));
    };
    response.success(res, [...collect('presets', 'preset'), ...collect('clips', 'clip')]);
  }
  function uploadVoice(req, res) {
    if (!req.file) return response.badRequest(res, '请选择参考音频');
    try {
      const root = storagePath(cfg);
      const dir = path.join(root, 'voice-references', 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      const ext = path.extname(req.file.originalname || '') || '.wav';
      const filename = `source_${randomUUID()}${ext.toLowerCase()}`;
      const target = path.join(dir, filename);
      if (req.file.path) {
        try { fs.renameSync(req.file.path, target); }
        catch (err) {
          if (err.code !== 'EXDEV') throw err;
          fs.copyFileSync(req.file.path, target);
          fs.unlinkSync(req.file.path);
        }
      }
      else fs.writeFileSync(target, req.file.buffer);
      const localPath = `voice-references/uploads/${filename}`;
      response.success(res, { id: localPath, label: path.basename(req.file.originalname || '参考音频', ext), kind: 'upload', path: localPath, url: `/static/${localPath}` });
    } catch (err) { response.internalError(res, err.message); }
  }
  function trimVoice(req, res) {
    try {
      const root = path.resolve(storagePath(cfg));
      const rel = String(req.body?.path || '').replace(/^[/\\]+/, '');
      const source = path.resolve(root, rel);
      if (!source.startsWith(root + path.sep) || !fs.existsSync(source)) return response.badRequest(res, '找不到原始参考音频');
      const start = Math.max(0, Number(req.body?.start) || 0);
      const duration = Math.min(15, Math.max(1, Number(req.body?.duration) || 10));
      const save = !!req.body?.save;
      const requestedName = String(req.body?.name || '').trim();
      const folder = save ? 'clips' : 'temp';
      const dir = path.join(root, 'voice-references', folder);
      fs.mkdirSync(dir, { recursive: true });
      const safeName = requestedName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_').slice(0, 40) || '裁剪音色';
      const filename = save ? `${safeName}_${randomUUID().slice(0, 8)}.wav` : `temp_${randomUUID().slice(0, 12)}.wav`;
      const output = path.join(dir, filename);
      const run = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(start), '-i', source, '-t', String(duration), '-ar', '22050', '-ac', '1', '-c:a', 'pcm_s16le', output], { encoding: 'utf8', timeout: 180000 });
      if (run.status !== 0 || !fs.existsSync(output)) throw new Error((run.stderr || '音频裁剪失败').trim());
      const localPath = `voice-references/${folder}/${filename}`;
      response.success(res, { id: localPath, label: save ? requestedName || '我的音色' : `本次片段 ${duration.toFixed(1)} 秒`, kind: save ? 'clip' : 'temporary', path: localPath, url: `/static/${localPath}`, duration, saved: save });
    } catch (err) { response.internalError(res, err.message); }
  }
  function list(req, res) {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const own = db.prepare('SELECT id, type, prompt, status, output_text, output_path, error_msg, created_at, completed_at FROM free_creations ORDER BY id DESC LIMIT ?').all(limit).map(x => ({ ...x, url: x.output_path ? '/static/' + x.output_path : null }));
    const images = db.prepare("SELECT id, 'image' type, prompt, status, image_url, local_path, error_msg, created_at, completed_at FROM image_generations WHERE deleted_at IS NULL AND (drama_id IS NULL OR drama_id = 0) AND storyboard_id IS NULL ORDER BY id DESC LIMIT ?").all(limit).map(x => ({ ...x, url: x.local_path ? '/static/' + x.local_path : x.image_url }));
    const videos = db.prepare("SELECT id, 'video' type, prompt, status, video_url, local_path, error_msg, created_at, completed_at FROM video_generations WHERE deleted_at IS NULL AND (drama_id IS NULL OR drama_id = 0) AND storyboard_id IS NULL ORDER BY id DESC LIMIT ?").all(limit).map(x => ({ ...x, url: x.local_path ? '/static/' + x.local_path : x.video_url }));
    response.success(res, [...own, ...images, ...videos].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit));
  }
  return { createText, createAudio, list, listVoices, uploadVoice, trimVoice };
}
module.exports = routes;
