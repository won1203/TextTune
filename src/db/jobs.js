const { getDb } = require('./connection');
const { parseJsonColumn, toJsonColumn } = require('./helpers');

function serializeJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    prompt_raw: row.prompt_raw,
    prompt_expanded: row.prompt_expanded,
    params: parseJsonColumn(row.params, {}),
    status: row.status,
    progress: typeof row.progress === 'number' ? row.progress : Number(row.progress) || 0,
    created_at: row.created_at,
    finished_at: row.finished_at,
    error_code: row.error_code || null,
    error: row.error || null,
    result_track_id: row.result_track_id || null,
    audio_url: row.audio_url || null,
  };
}

function create(job) {
  const db = getDb();
  const now = job.created_at || new Date().toISOString();
  db.prepare(`
    INSERT INTO generation_jobs
      (id, user_id, prompt_raw, prompt_expanded, params, status, progress, created_at, finished_at, error_code, error, result_track_id, audio_url)
    VALUES
      (@id, @user_id, @prompt_raw, @prompt_expanded, @params, @status, @progress, @created_at, @finished_at, @error_code, @error, @result_track_id, @audio_url)
  `).run({
    id: job.id,
    user_id: job.userId,
    prompt_raw: job.prompt_raw,
    prompt_expanded: job.prompt_expanded,
    params: toJsonColumn(job.params),
    status: job.status || 'queued',
    progress: Number(job.progress ?? 0) || 0,
    created_at: now,
    finished_at: job.finished_at || null,
    error_code: job.error_code || null,
    error: job.error || null,
    result_track_id: job.result_track_id || null,
    audio_url: job.audio_url || null,
  });
  return serializeJob({
    id: job.id,
    user_id: job.userId,
    prompt_raw: job.prompt_raw,
    prompt_expanded: job.prompt_expanded,
    params: toJsonColumn(job.params),
    status: job.status || 'queued',
    progress: Number(job.progress ?? 0) || 0,
    created_at: now,
    finished_at: job.finished_at || null,
    error_code: job.error_code || null,
    error: job.error || null,
    result_track_id: job.result_track_id || null,
    audio_url: job.audio_url || null,
  });
}

function findByIdForUser(id, userId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM generation_jobs WHERE id = ? AND user_id = ?').get(id, userId);
  return serializeJob(row);
}

function setProgress(id, userId, progress) {
  const db = getDb();
  db.prepare('UPDATE generation_jobs SET progress = @progress WHERE id = @id AND user_id = @user_id')
    .run({ id, user_id: userId, progress });
}

function markRunning(id, userId, progress) {
  const db = getDb();
  db.prepare('UPDATE generation_jobs SET status = @status, progress = @progress WHERE id = @id AND user_id = @user_id')
    .run({ id, user_id: userId, status: 'running', progress });
}

function markSucceeded(id, userId, { finished_at, result_track_id, audio_url }) {
  const db = getDb();
  db.prepare(`
    UPDATE generation_jobs
      SET status = @status,
          progress = @progress,
          finished_at = @finished_at,
          error_code = NULL,
          error = NULL,
          result_track_id = @result_track_id,
          audio_url = @audio_url
      WHERE id = @id AND user_id = @user_id
  `).run({
    id,
    user_id: userId,
    status: 'succeeded',
    progress: 1,
    finished_at,
    result_track_id,
    audio_url,
  });
}

function markFailed(id, userId, { finished_at, progress = 1, error, error_code }) {
  const db = getDb();
  db.prepare(`
    UPDATE generation_jobs
      SET status = @status,
          progress = @progress,
          finished_at = @finished_at,
          error_code = @error_code,
          error = @error
      WHERE id = @id AND user_id = @user_id
  `).run({
    id,
    user_id: userId,
    status: 'failed',
    progress: Number(progress ?? 1) || 1,
    finished_at,
    error_code: error_code || 'render_error',
    error,
  });
}

module.exports = {
  create,
  findByIdForUser,
  setProgress,
  markRunning,
  markSucceeded,
  markFailed,
};
