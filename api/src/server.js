const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { synthesizeWav } = require('./audio/synth');
const { generateStableAudioTrack } = require('./audio/huggingface');
const { generateSpaceAudioTrack } = require('./audio/spaces');

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || `http://localhost:${PORT}`;
const MAX_DURATION_SECONDS = Number(process.env.MAX_DURATION_SECONDS || 12);
const HF_SPACE_ID = (process.env.HF_SPACE_ID || '').trim();
const HF_API_TOKEN = (process.env.HF_API_TOKEN || '').trim();
const HF_ENABLED = Boolean(HF_SPACE_ID || HF_API_TOKEN);

const app = express();

app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(cors({ origin: ALLOW_ORIGIN, credentials: true }));

// In-memory stores (replace with DB later)
const db = {
  users: new Map(), // id -> { id, email, createdAt }
  jobs: new Map(),  // jobId -> { ... }
  tracks: new Map() // trackId -> { ... }
};

// Auth helpers
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function authRequired(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

// Very simple dev login (email only)
app.post('/v1/auth/login', (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'invalid_email' });
  let user = Array.from(db.users.values()).find(u => u.email === email);
  if (!user) {
    user = { id: uuidv4(), email, createdAt: new Date().toISOString(), plan: 'free' };
    db.users.set(user.id, user);
  }
  const token = signToken({ userId: user.id, email: user.email });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true, user: { id: user.id, email: user.email } });
});

app.post('/v1/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/v1/me', authRequired, (req, res) => {
  const user = db.users.get(req.user.userId);
  if (!user) {
    res.clearCookie('token');
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json({ id: user.id, email: user.email, plan: user.plan });
});

// Safety filter (very basic)
const BANNED = ['hate', 'violence', 'illegal', 'terror', 'child', 'sexual', 'porn'];
function violatesPolicy(prompt) {
  const p = (prompt || '').toLowerCase();
  return BANNED.some(k => p.includes(k));
}

// Generation queue (in-memory)
const queue = [];
let active = 0;
const MAX_CONCURRENCY = 1; // Single GPU equivalent in MVP

function contentTypeForFormat(format) {
  switch ((format || '').toLowerCase()) {
    case 'mp3':
      return 'audio/mpeg';
    case 'flac':
      return 'audio/flac';
    case 'ogg':
    case 'oga':
      return 'audio/ogg';
    case 'wav':
    default:
      return 'audio/wav';
  }
}

function processQueue() {
  if (active >= MAX_CONCURRENCY) return;
  const next = queue.shift();
  if (!next) return;
  runJob(next);
}

async function runJob(job) {
  active++;
  job.status = 'running';
  job.progress = 0.05;
  broadcastProgress(job);

  const start = Date.now();
  const tick = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    const approxDur = (job.params.duration || 10);
    job.progress = Math.min(0.9, 0.1 + elapsed / Math.max(3, approxDur - 2));
    broadcastProgress(job);
  }, 500);

  try {
    if (!HF_ENABLED) {
      const renderMs = Math.max(1500, (job.params.duration || 10) * 300);
      await new Promise(r => setTimeout(r, renderMs));
    }

    const tracksDir = path.join(__dirname, '..', 'storage', job.userId);
    const trackId = uuidv4();
    let renderInfo;

    if (HF_SPACE_ID) {
      renderInfo = await generateSpaceAudioTrack({
        prompt: job.prompt_expanded,
        durationSec: job.params.duration ?? undefined,
        samplerate: job.params.samplerate,
        seed: job.params.seed,
        outDir: tracksDir,
        filenamePrefix: trackId,
        spaceId: HF_SPACE_ID,
      });
    } else if (HF_API_TOKEN) {
      renderInfo = await generateStableAudioTrack({
        prompt: job.prompt_expanded,
        durationSec: job.params.duration ?? undefined,
        samplerate: job.params.samplerate,
        seed: job.params.seed,
        outDir: tracksDir,
        filenamePrefix: trackId,
      });
    } else {
      const wavPath = path.join(tracksDir, `${trackId}.wav`);
      synthesizeWav({
        prompt: job.prompt_expanded,
        seed: job.params.seed || 0,
        durationSec: job.params.duration || 12,
        sampleRate: job.params.samplerate,
        outPath: wavPath,
      });
      renderInfo = {
        filePath: wavPath,
        format: 'wav',
        contentType: 'audio/wav',
      };
    }

    const track = {
      id: trackId,
      user_id: job.userId,
      job_id: job.id,
      duration: job.params.duration,
      samplerate: job.params.samplerate,
      bitrate: null,
      format: renderInfo.format || 'wav',
      storage_key_original: renderInfo.filePath,
      storage_key_mp3: null,
      public: false,
      created_at: new Date().toISOString(),
      prompt_raw: job.prompt_raw,
      prompt_expanded: job.prompt_expanded,
      params: job.params,
    };
    db.tracks.set(track.id, track);

    job.status = 'succeeded';
    job.progress = 1.0;
    job.finished_at = new Date().toISOString();
    job.result_track_id = track.id;
    job.audio_url = `/v1/stream/${track.id}`;
    broadcastProgress(job);
  } catch (e) {
    job.status = 'failed';
    job.error = 'render_error';
    console.error('Render job failed', e);
  } finally {
    clearInterval(tick);
    active--;
    processQueue();
  }
}
function broadcastProgress(_job) { /* no-op */ }

function expandPrompt(raw) {
  const base = (raw || '').trim();
  if (!base) return '';
  // Very light template per PRD
  return `${base}, instrumental, clean mix, mastered, no vocals`;
}

// Create generation job
app.post('/v1/generations', authRequired, (req, res) => {
  const { prompt, duration, samplerate = 44100, seed = null, quality = 'draft' } = req.body || {};
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'invalid_prompt' });
  if (violatesPolicy(prompt)) return res.status(400).json({ error: 'blocked_prompt' });
  if (typeof duration === 'number' && duration > MAX_DURATION_SECONDS) return res.status(400).json({ error: 'duration_too_long', max: MAX_DURATION_SECONDS });

  const jobId = uuidv4();
  const params = { duration: duration == null ? null : Math.max(1, Number(duration)), samplerate: Number(samplerate), seed, quality };
  const job = {
    id: jobId,
    userId: req.user.userId,
    prompt_raw: prompt,
    prompt_expanded: expandPrompt(prompt),
    params,
    status: 'queued',
    progress: 0,
    created_at: new Date().toISOString(),
    finished_at: null,
    error: null,
    audio_url: null,
  };
  db.jobs.set(jobId, job);
  queue.push(job);
  processQueue();
  res.json({ job_id: jobId, status: job.status });
});

// Get job status
app.get('/v1/generations/:jobId', authRequired, (req, res) => {
  const job = db.jobs.get(req.params.jobId);
  if (!job || job.userId !== req.user.userId) return res.status(404).json({ error: 'not_found' });
  res.json({
    status: job.status,
    progress: job.progress,
    audio_url: job.audio_url,
    params: job.params,
    error: job.error,
    job_id: job.id,
    track_id: job.result_track_id || null,
  });
});

// Library list
app.get('/v1/library', authRequired, (req, res) => {
  const items = Array.from(db.tracks.values())
    .filter(t => t.user_id === req.user.userId)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, Number(req.query.limit) || 20)
    .map(t => ({
      id: t.id,
      created_at: t.created_at,
      duration: t.duration,
      samplerate: t.samplerate,
      format: t.format,
      audio_url: `/v1/stream/${t.id}`,
      download_url: `/v1/download/${t.id}`,
      prompt_expanded: t.prompt_expanded,
    }));
  res.json({ items, next_cursor: null });
});

// Delete from library
app.delete('/v1/library/:trackId', authRequired, (req, res) => {
  const t = db.tracks.get(req.params.trackId);
  if (!t || t.user_id !== req.user.userId) return res.status(404).json({ error: 'not_found' });
  db.tracks.delete(t.id);
  try { fs.unlinkSync(t.storage_key_original); } catch {}
  res.json({ ok: true });
});

// Track metadata
app.get('/v1/tracks/:trackId', authRequired, (req, res) => {
  const t = db.tracks.get(req.params.trackId);
  if (!t || t.user_id !== req.user.userId) return res.status(404).json({ error: 'not_found' });
  res.json({
    id: t.id,
    created_at: t.created_at,
    duration: t.duration,
    samplerate: t.samplerate,
    format: t.format,
    audio_url: `/v1/stream/${t.id}`,
    download_url: `/v1/download/${t.id}`,
    prompt_raw: t.prompt_raw,
    prompt_expanded: t.prompt_expanded,
    params: t.params,
  });
});

// Stream with range support
app.get('/v1/stream/:trackId', authRequired, (req, res) => {
  const t = db.tracks.get(req.params.trackId);
  if (!t || t.user_id !== req.user.userId) return res.status(404).end();
  const file = t.storage_key_original;
  if (!fs.existsSync(file)) return res.status(404).end();
  const stat = fs.statSync(file);
  const fileSize = stat.size;
  const range = req.headers.range;
  const mimeType = contentTypeForFormat(t.format);
  res.setHeader('Accept-Ranges', 'bytes');
  if (range) {
    const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
    let start = parseInt(startStr, 10);
    let end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    if (isNaN(start) || isNaN(end) || start > end) return res.status(416).end();
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
    });
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
    });
    fs.createReadStream(file).pipe(res);
  }
});

// Download (attachment)
app.get('/v1/download/:trackId', authRequired, (req, res) => {
  const t = db.tracks.get(req.params.trackId);
  if (!t || t.user_id !== req.user.userId) return res.status(404).end();
  const ext = (t.format || 'wav').toLowerCase();
  const mimeType = contentTypeForFormat(ext);
  res.setHeader('Content-Disposition', `attachment; filename="texttune-${t.id}.${ext}"`);
  res.setHeader('Content-Type', mimeType);
  fs.createReadStream(t.storage_key_original).pipe(res);
});

// Static pages (very basic MVP UI)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback explicit routes for static pages (helps in some hosting setups)
app.get('/generate.html', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'generate.html'));
});
app.get('/library.html', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'library.html'));
});
app.get('/track.html', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'track.html'));
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`TextTune API listening on http://localhost:${PORT}`);
});
