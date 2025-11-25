const { getDb } = require('./connection');
const { parseJsonColumn, toJsonColumn } = require('./helpers');

function serializeTrack(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    job_id: row.job_id || null,
    duration: typeof row.duration === 'number' ? row.duration : Number(row.duration) || null,
    samplerate: row.samplerate ? Number(row.samplerate) : null,
    bitrate: row.bitrate ? Number(row.bitrate) : null,
    format: row.format || null,
    storage_key_original: row.storage_key_original,
    storage_key_mp3: row.storage_key_mp3 || null,
    public: Boolean(row.public),
    created_at: row.created_at,
    prompt_raw: row.prompt_raw,
    prompt_expanded: row.prompt_expanded,
    params: parseJsonColumn(row.params, {}),
  };
}

function insert(track) {
  const db = getDb();
  const createdAt = track.created_at || new Date().toISOString();
  db.prepare(`
    INSERT INTO tracks
      (id, user_id, job_id, duration, samplerate, bitrate, format, storage_key_original, storage_key_mp3, public, created_at, prompt_raw, prompt_expanded, params)
    VALUES
      (@id, @user_id, @job_id, @duration, @samplerate, @bitrate, @format, @storage_key_original, @storage_key_mp3, @public, @created_at, @prompt_raw, @prompt_expanded, @params)
  `).run({
    id: track.id,
    user_id: track.user_id,
    job_id: track.job_id || null,
    duration: track.duration ?? null,
    samplerate: track.samplerate ?? null,
    bitrate: track.bitrate ?? null,
    format: track.format || null,
    storage_key_original: track.storage_key_original,
    storage_key_mp3: track.storage_key_mp3 || null,
    public: track.public ? 1 : 0,
    created_at: createdAt,
    prompt_raw: track.prompt_raw || null,
    prompt_expanded: track.prompt_expanded || null,
    params: toJsonColumn(track.params),
  });
  return serializeTrack({ ...track, created_at: createdAt });
}

function insertAndLinkToJob(track, jobMeta) {
  const db = getDb();
  const createdAt = track.created_at || new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT INTO tracks
      (id, user_id, job_id, duration, samplerate, bitrate, format, storage_key_original, storage_key_mp3, public, created_at, prompt_raw, prompt_expanded, params)
    VALUES
      (@id, @user_id, @job_id, @duration, @samplerate, @bitrate, @format, @storage_key_original, @storage_key_mp3, @public, @created_at, @prompt_raw, @prompt_expanded, @params)
  `);

  const updateJobStmt = db.prepare(`
    UPDATE generation_jobs
      SET status = 'succeeded',
          progress = 1,
          finished_at = @finished_at,
          error_code = NULL,
          error = NULL,
          result_track_id = @track_id,
          audio_url = @audio_url
      WHERE id = @job_id AND user_id = @user_id
  `);

  const tx = db.transaction((t, job) => {
    insertStmt.run({
      id: t.id,
      user_id: t.user_id,
      job_id: t.job_id || null,
      duration: t.duration ?? null,
      samplerate: t.samplerate ?? null,
      bitrate: t.bitrate ?? null,
      format: t.format || null,
      storage_key_original: t.storage_key_original,
      storage_key_mp3: t.storage_key_mp3 || null,
      public: t.public ? 1 : 0,
      created_at: createdAt,
      prompt_raw: t.prompt_raw || null,
      prompt_expanded: t.prompt_expanded || null,
      params: toJsonColumn(t.params),
    });
    const result = updateJobStmt.run({
      job_id: job.jobId,
      user_id: job.userId,
      finished_at: job.finished_at,
      track_id: t.id,
      audio_url: job.audio_url,
    });
    if (result.changes === 0) {
      throw new Error('job_update_failed');
    }
  });

  tx(track, jobMeta);
  return serializeTrack({ ...track, created_at: createdAt });
}

function findByIdForUser(id, userId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tracks WHERE id = ? AND user_id = ?').get(id, userId);
  return serializeTrack(row);
}

function listByUser(userId, limit = 20) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM tracks
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?
  `).all(userId, limit);
  return rows.map(serializeTrack);
}

function deleteByIdForUser(id, userId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM tracks WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return null;
  db.prepare('DELETE FROM tracks WHERE id = ? AND user_id = ?').run(id, userId);
  return serializeTrack(row);
}

module.exports = {
  insert,
  insertAndLinkToJob,
  findByIdForUser,
  listByUser,
  deleteByIdForUser,
};
