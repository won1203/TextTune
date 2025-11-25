const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const { v4: uuidv4 } = require('uuid');
const { initDb, usersRepo, jobsRepo, tracksRepo } = require('./db');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { generateSpaceAudioTrack } = require('./audio/spaces');
const { translatePromptToEnglishIfNeeded } = require('./translate/google');

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || `http://localhost:${PORT}`;
const MAX_DURATION_SECONDS = Number(process.env.MAX_DURATION_SECONDS || 30);
const DEFAULT_DURATION_SECONDS = Number(process.env.DEFAULT_DURATION_SECONDS || 30);
const HF_SPACE_ID = (process.env.HF_SPACE_ID || '').trim();
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || '').trim();
const GOOGLE_CLIENT_SECRET = (process.env.GOOGLE_CLIENT_SECRET || '').trim();
const GOOGLE_REDIRECT_URI = (process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/v1/auth/google/callback`).trim();
const googleOAuthClient = (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET)
  ? new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)
  : null;

const app = express();
initDb();

const authStates = new Map(); // state -> { codeVerifier, next, createdAt }
const STATE_TTL_MS = 10 * 60 * 1000;

function randomBase64Url(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function toCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest().toString('base64url');
}

function sanitizeNext(next) {
  if (!next || typeof next !== 'string') return '/';
  if (next.startsWith('/')) return next;
  return '/';
}

function storeAuthState(state, data) {
  authStates.set(state, { ...data, createdAt: Date.now() });
}

function consumeAuthState(state) {
  const entry = authStates.get(state);
  if (entry) authStates.delete(state);
  if (!entry) return null;
  if ((Date.now() - entry.createdAt) > STATE_TTL_MS) return null;
  return entry;
}

function purgeAuthStates() {
  const now = Date.now();
  for (const [key, val] of authStates) {
    if ((now - val.createdAt) > STATE_TTL_MS) authStates.delete(key);
  }
}

app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(cors({ origin: ALLOW_ORIGIN, credentials: true }));

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

// Google OAuth (Authorization Code + PKCE)
app.get('/v1/auth/google/start', (req, res) => {
  if (!googleOAuthClient) return res.status(500).send('google_oauth_not_configured');
  purgeAuthStates();
  const state = randomBase64Url(16);
  const codeVerifier = randomBase64Url(32);
  const codeChallenge = toCodeChallenge(codeVerifier);
  const next = sanitizeNext(req.query.next || '/generate.html');
  storeAuthState(state, { codeVerifier, next });
  const url = googleOAuthClient.generateAuthUrl({
    access_type: 'online',
    response_type: 'code',
    scope: ['openid', 'email', 'profile'],
    state,
    redirect_uri: GOOGLE_REDIRECT_URI,
    prompt: 'select_account',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    include_granted_scopes: true,
  });
  res.redirect(url);
});

app.get('/v1/auth/google/callback', async (req, res) => {
  if (!googleOAuthClient) return res.status(500).send('google_oauth_not_configured');
  purgeAuthStates();
  const { state, code, error } = req.query || {};
  if (error) return res.status(400).send(`google_oauth_error: ${error}`);
  if (!state || !code) return res.status(400).send('missing_state_or_code');

  const saved = consumeAuthState(state);
  if (!saved) return res.status(400).send('invalid_state');

  try {
    const tokenRes = await googleOAuthClient.getToken({
      code,
      codeVerifier: saved.codeVerifier,
      redirect_uri: GOOGLE_REDIRECT_URI,
    });
    const idToken = tokenRes.tokens?.id_token;
    if (!idToken) throw new Error('missing_id_token');

    const ticket = await googleOAuthClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload() || {};
    const sub = payload.sub;
    const email = payload.email;
    if (!sub || !email) throw new Error('missing_profile');

    const user = usersRepo.upsertGoogleProfile({
      sub,
      email,
      name: payload.name || '',
      picture: payload.picture || '',
    });

    const token = signToken({ userId: user.id, email: user.email });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
    res.redirect(saved.next || '/');
  } catch (e) {
    console.error('Google OAuth callback failed', e);
    res.status(500).send('login_failed');
  }
});

// Very simple dev login (email only)
app.post('/v1/auth/login', (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') return res.status(400).json({ error: 'invalid_email' });
  const user = usersRepo.findOrCreateByEmail(email);
  const token = signToken({ userId: user.id, email: user.email });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true, user: { id: user.id, email: user.email } });
});

app.post('/v1/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/v1/me', authRequired, (req, res) => {
  const user = usersRepo.findById(req.user.userId);
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
  jobsRepo.markRunning(job.id, job.userId, job.progress);
  broadcastProgress(job);

  const start = Date.now();
  const tick = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000;
    const approxDur = (job.params.duration || 10);
    job.progress = Math.min(0.9, 0.1 + elapsed / Math.max(3, approxDur - 2));
    jobsRepo.setProgress(job.id, job.userId, job.progress);
    broadcastProgress(job);
  }, 500);

  try {
    if (!HF_SPACE_ID) {
      throw new Error('HF_SPACE_ID is not configured.');
    }

    const tracksDir = path.join(__dirname, '..', 'storage', job.userId);
    const trackId = uuidv4();
    const renderInfo = await generateSpaceAudioTrack({
      prompt: job.prompt_expanded,
      durationSec: job.params.duration ?? undefined,
      samplerate: job.params.samplerate,
      seed: job.params.seed,
      outDir: tracksDir,
      filenamePrefix: trackId,
    });

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
    const finishedAt = track.created_at;

    tracksRepo.insertAndLinkToJob(track, {
      jobId: job.id,
      userId: job.userId,
      finished_at: finishedAt,
      audio_url: `/v1/stream/${track.id}`,
    });

    job.status = 'succeeded';
    job.progress = 1.0;
    job.finished_at = finishedAt;
    job.result_track_id = track.id;
    job.audio_url = `/v1/stream/${track.id}`;
    job.error = null;
    job.error_code = null;
    broadcastProgress(job);
  } catch (e) {
    job.status = 'failed';
    const errMsg = typeof e === 'string'
      ? e
      : (e?.userMessage || e?.message || e?.details || 'render_error');
    job.error = errMsg;
    job.error_code = e?.code || 'render_error';
    job.progress = 1;
    job.finished_at = new Date().toISOString();
    jobsRepo.markFailed(job.id, job.userId, {
      finished_at: job.finished_at,
      progress: job.progress,
      error: job.error,
      error_code: job.error_code,
    });
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

function promptTitleFromTrack(track) {
  if (!track) return '?�랙';
  const raw = (track.prompt_raw || track.prompt_expanded || '').trim();
  if (raw) return raw;
  const idPart = (track.id || '').toString().slice(0, 8) || 'track';
  return `?�랙 #${idPart}`;
}

// Create generation job
app.post('/v1/generations', authRequired, async (req, res) => {
  try {
    const { prompt, duration, samplerate = 44100, seed = null, quality = 'draft' } = req.body || {};
    if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'invalid_prompt' });
    if (violatesPolicy(prompt)) return res.status(400).json({ error: 'blocked_prompt' });
    if (typeof duration === 'number' && duration > MAX_DURATION_SECONDS) {
      return res.status(400).json({ error: 'duration_too_long', max: MAX_DURATION_SECONDS });
    }

    const jobId = uuidv4();
    const sanitizedDuration = typeof duration === 'number' ? duration : Number(duration);
    const requestedDuration = duration == null || Number.isNaN(sanitizedDuration)
      ? DEFAULT_DURATION_SECONDS
      : Math.max(1, sanitizedDuration);
    const clampedDuration = Math.min(requestedDuration, MAX_DURATION_SECONDS);
    const params = { duration: clampedDuration, samplerate: Number(samplerate), seed, quality };

    let modelPrompt = prompt;
    try {
      modelPrompt = await translatePromptToEnglishIfNeeded(prompt);
    } catch (e) {
      console.error('Prompt translation failed; using original prompt.', e);
      modelPrompt = prompt;
    }

    const job = {
      id: jobId,
      userId: req.user.userId,
      prompt_raw: prompt,
      prompt_expanded: expandPrompt(modelPrompt),
      params,
      status: 'queued',
      progress: 0,
      created_at: new Date().toISOString(),
      finished_at: null,
      error: null,
      error_code: null,
      audio_url: null,
    };
    const persisted = jobsRepo.create(job);
    queue.push({ ...job, created_at: persisted.created_at });
    processQueue();
    res.json({ job_id: jobId, status: job.status });
  } catch (err) {
    console.error('Failed to create generation job', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Get job status
app.get('/v1/generations/:jobId', authRequired, (req, res) => {
  const job = jobsRepo.findByIdForUser(req.params.jobId, req.user.userId);
  if (!job) return res.status(404).json({ error: 'not_found' });
  res.json({
    status: job.status,
    progress: job.progress,
    audio_url: job.audio_url,
    params: job.params,
    error: job.error,
    error_code: job.error_code || null,
    job_id: job.id,
    track_id: job.result_track_id || null,
  });
});

// Library list
app.get('/v1/library', authRequired, (req, res) => {
  const limit = Number(req.query.limit) || 20;
  const tracks = tracksRepo.listByUser(req.user.userId, limit);
  const items = tracks.map(t => ({
    id: t.id,
    created_at: t.created_at,
    duration: t.duration,
    samplerate: t.samplerate,
    format: t.format,
    audio_url: `/v1/stream/${t.id}`,
    download_url: `/v1/download/${t.id}`,
    prompt_raw: t.prompt_raw,
    prompt_expanded: t.prompt_expanded,
    prompt_title: promptTitleFromTrack(t),
  }));
  res.json({ items, next_cursor: null });
});

// Delete from library
app.delete('/v1/library/:trackId', authRequired, (req, res) => {
  const t = tracksRepo.deleteByIdForUser(req.params.trackId, req.user.userId);
  if (!t) return res.status(404).json({ error: 'not_found' });
  try { fs.unlinkSync(t.storage_key_original); } catch {}
  res.json({ ok: true });
});

// Track metadata
app.get('/v1/tracks/:trackId', authRequired, (req, res) => {
  const t = tracksRepo.findByIdForUser(req.params.trackId, req.user.userId);
  if (!t) return res.status(404).json({ error: 'not_found' });
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
    prompt_title: promptTitleFromTrack(t),
    params: t.params,
  });
});

// Stream with range support
app.get('/v1/stream/:trackId', authRequired, (req, res) => {
  const t = tracksRepo.findByIdForUser(req.params.trackId, req.user.userId);
  if (!t) return res.status(404).end();
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
  const t = tracksRepo.findByIdForUser(req.params.trackId, req.user.userId);
  if (!t) return res.status(404).end();
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



