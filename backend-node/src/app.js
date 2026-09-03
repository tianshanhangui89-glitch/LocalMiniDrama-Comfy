const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./db/index.js');
const { loadConfig } = require('./config/index.js');
const logger = require('./logger.js');
const { setupRouter } = require('./routes/index.js');

function createApp() {
  const config = loadConfig();
  const db = getDb(config.database);
  const { runMigrationsAndEnsure } = require('./db/migrate.js');
  runMigrationsAndEnsure(db);

  // Fresh local deployments should work without a cloud-video key. Existing
  // user-created video providers remain untouched; this only seeds H3 once.
  const localH3 = db.prepare(
    "SELECT id FROM ai_service_configs WHERE deleted_at IS NULL AND service_type = 'video' AND provider = 'local_comfy_h3' LIMIT 1"
  ).get();
  if (!localH3) {
    const now = new Date().toISOString();
    db.prepare("UPDATE ai_service_configs SET is_default = 0 WHERE deleted_at IS NULL AND service_type = 'video'").run();
    db.prepare(
      `INSERT INTO ai_service_configs (service_type, provider, api_protocol, name, base_url, api_key, model, default_model, endpoint, query_endpoint, priority, is_default, is_active, settings, created_at, updated_at)
       VALUES ('video', 'local_comfy_h3', 'local_comfy_h3', '本机 ComfyUI · MiniMax H3', 'http://127.0.0.1:8188', '', ?, 'MiniMax-H3-Local', '', '', 100, 1, 1, ?, ?, ?)`
    ).run(JSON.stringify(['MiniMax-H3-Local']), JSON.stringify({ timeout_seconds: 1800 }), now, now);
    logger.info('Seeded local ComfyUI MiniMax H3 video provider');
  }

  const localZImage = db.prepare(
    "SELECT id FROM ai_service_configs WHERE deleted_at IS NULL AND service_type = 'image' AND provider = 'local_comfy_zimage' LIMIT 1"
  ).get();
  if (!localZImage) {
    const now = new Date().toISOString();
    db.prepare("UPDATE ai_service_configs SET is_default = 0 WHERE deleted_at IS NULL AND service_type = 'image'").run();
    db.prepare(
      `INSERT INTO ai_service_configs (service_type, provider, api_protocol, name, base_url, api_key, model, default_model, endpoint, query_endpoint, priority, is_default, is_active, settings, created_at, updated_at)
       VALUES ('image', 'local_comfy_zimage', 'local_comfy_zimage', '本机 ComfyUI · Z-Image-Turbo', 'http://127.0.0.1:8188', '', ?, 'Z-Image-Turbo-Local', '', '', 100, 1, 1, ?, ?, ?)`
    ).run(JSON.stringify(['Z-Image-Turbo-Local']), JSON.stringify({ steps: 8, timeout_seconds: 1200 }), now, now);
    logger.info('Seeded local ComfyUI Z-Image-Turbo image provider');
  }

  // Qwen3 is served locally by llama.cpp with an OpenAI-compatible endpoint.
  // Keep this on CPU by default so video/image jobs retain the full RTX 4090.
  const localQwen = db.prepare(
    "SELECT id FROM ai_service_configs WHERE deleted_at IS NULL AND service_type = 'text' AND provider = 'local_llama_qwen3' LIMIT 1"
  ).get();
  if (!localQwen) {
    const now = new Date().toISOString();
    db.prepare("UPDATE ai_service_configs SET is_default = 0 WHERE deleted_at IS NULL AND service_type = 'text'").run();
    db.prepare(
      `INSERT INTO ai_service_configs (service_type, provider, api_protocol, name, base_url, api_key, model, default_model, endpoint, query_endpoint, priority, is_default, is_active, settings, created_at, updated_at)
       VALUES ('text', 'local_llama_qwen3', 'openai', '本机 Qwen3-8B（Q5 量化）', 'http://127.0.0.1:11435/v1', '', ?, 'Qwen3-8B-Q5_K_M', '/chat/completions', '', 100, 1, 1, ?, ?, ?)`
    ).run(JSON.stringify(['Qwen3-8B-Q5_K_M']), JSON.stringify({ context_length: 8192, local: true }), now, now);
    logger.info('Seeded local Qwen3 text provider');
  }

  const localTts = db.prepare(
    "SELECT id FROM ai_service_configs WHERE deleted_at IS NULL AND service_type = 'tts' AND provider = 'local_confucius4' LIMIT 1"
  ).get();
  if (!localTts) {
    const now = new Date().toISOString();
    db.prepare("UPDATE ai_service_configs SET is_default = 0 WHERE deleted_at IS NULL AND service_type = 'tts'").run();
    db.prepare(
      `INSERT INTO ai_service_configs (service_type, provider, api_protocol, name, base_url, api_key, model, default_model, endpoint, query_endpoint, priority, is_default, is_active, settings, created_at, updated_at)
       VALUES ('tts', 'local_confucius4', 'local_confucius4', 'Confucius4-TTS（局域网音色克隆）', 'http://192.168.1.116:7860', '', ?, 'Confucius4-TTS', '', '', 100, 1, 1, ?, ?, ?)`
    ).run(JSON.stringify(['Confucius4-TTS']), JSON.stringify({ language: '中文', diffusion_steps: 25 }), now, now);
    logger.info('Seeded Confucius4-TTS LAN provider');
  }

  // 厂商锁定模式：在迁移完成后同步 vendor_lock 配置
  const { applyVendorLock } = require('./services/aiConfigService');
  applyVendorLock(db, logger, config);
  const log = logger;

  const taskService = require('./services/taskService');
  taskService.failOrphanedAsyncTasksOnStartup(db, log);

  const { resumeProcessingVideoGenerations } = require('./services/videoService');
  resumeProcessingVideoGenerations(db, log);

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(
    cors({
      origin: config.server.cors_origins && config.server.cors_origins.length
        ? config.server.cors_origins
        : '*',
    })
  );

  app.use((req, res, next) => {
    log.info(req.method, req.path);
    next();
  });

  // 静态资源目录：统一转为绝对路径（打包 exe 下相对路径可能解析异常）
  const storageRoot = config.storage?.local_path
    ? (path.isAbsolute(config.storage.local_path)
        ? config.storage.local_path
        : path.join(process.cwd(), config.storage.local_path))
    : path.join(process.cwd(), 'data', 'storage');
  try {
    if (!fs.existsSync(storageRoot)) fs.mkdirSync(storageRoot, { recursive: true });
    app.use('/static', express.static(storageRoot));
  } catch (e) {
    console.warn('Static storage mount skipped:', e.message);
  }

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      app: config.app.name,
      version: config.app.version,
    });
  });

  app.use('/api/v1', setupRouter(config, db, log));

  // 前端静态资源（sxy：web/dist）；Electron 打包时可设 WEB_DIST_PATH
  const webDist = process.env.WEB_DIST_PATH || path.join(process.cwd(), '..', 'frontweb', 'dist');
  console.log('webDist', webDist);
  if (fs.existsSync(webDist)) {
    app.use('/assets', express.static(path.join(webDist, 'assets')));
    // 服务 dist 根目录的静态文件（如 wx.jpg、favicon.ico 等）
    app.use(express.static(webDist, { index: false }));
    app.get('/favicon.ico', (req, res) => {
      const fav = path.join(webDist, 'favicon.ico');
      if (fs.existsSync(fav)) res.sendFile(fav);
      else res.status(404).end();
    });
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      const indexHtml = path.join(webDist, 'index.html');
      if (fs.existsSync(indexHtml)) res.sendFile(indexHtml);
      else next();
    });
  } else {
    app.get('/', (req, res) => {
      res.send(
        '<!DOCTYPE html><html><head><meta charset="utf-8"><title>LocalMiniDrama</title></head><body>' +
          '<h1>LocalMiniDrama API</h1><p>后端已启动。请先构建前端：</p>' +
          '<pre>cd web &amp;&amp; pnpm install &amp;&amp; pnpm build</pre>' +
          '<p>然后将 <code>web/dist</code> 放到与 backend-node 同级的 <code>web/dist</code>，或访问 <a href="/health">/health</a> 检查接口。</p></body></html>'
      );
    });
  }

  app.use((req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.status(404).send('Not Found');
  });

  app.use((err, req, res, next) => {
    log.errorw('Unhandled error', { error: err.message, path: req.path });
    if (!res.headersSent) {
      const isFileTooLarge = err.code === 'LIMIT_FILE_SIZE' || (err.message && err.message.includes('File too large'));
      const status = isFileTooLarge ? 413 : 500;
      const message = isFileTooLarge ? '图片大小不能超过 16MB，请压缩后重试' : (err.message || '服务器错误');
      res.status(status).json({ success: false, error: { code: isFileTooLarge ? 'FILE_TOO_LARGE' : 'INTERNAL_ERROR', message }, timestamp: new Date().toISOString() });
    }
  });

  return { app, config, db };
}

module.exports = { createApp };
