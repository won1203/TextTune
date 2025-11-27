const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./connection');

function serializePlaylist(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    created_at: row.created_at,
  };
}

function serializeTrack(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    job_id: row.job_id,
    duration: row.duration ? Number(row.duration) : null,
    samplerate: row.samplerate ? Number(row.samplerate) : null,
    format: row.format || null,
    storage_key_original: row.storage_key_original,
    storage_key_mp3: row.storage_key_mp3 || null,
    public: Boolean(row.public),
    created_at: row.created_at,
    prompt_raw: row.prompt_raw,
    prompt_expanded: row.prompt_expanded,
    params: row.params ? (() => { try { return JSON.parse(row.params); } catch { return {}; } })() : {},
    playlist_pos: row.pos ? Number(row.pos) : 0,
  };
}

function createPlaylist(userId, title) {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO playlists (id, user_id, title, created_at)
    VALUES (@id, @user_id, @title, @created_at)
  `).run({ id, user_id: userId, title: title || '새 플레이리스트', created_at: now });
  return serializePlaylist({ id, user_id: userId, title: title || '새 플레이리스트', created_at: now });
}

function listPlaylists(userId) {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM playlists WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  return rows.map(serializePlaylist);
}

function getPlaylist(userId, playlistId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM playlists WHERE id = ? AND user_id = ?').get(playlistId, userId);
  return serializePlaylist(row);
}

function deletePlaylist(userId, playlistId) {
  const db = getDb();
  const res = db.prepare('DELETE FROM playlists WHERE id = ? AND user_id = ?').run(playlistId, userId);
  return res.changes > 0;
}

function addTrack(userId, playlistId, track) {
  const db = getDb();
  const pl = getPlaylist(userId, playlistId);
  if (!pl) return null;
  const now = new Date().toISOString();
  const maxPos = db.prepare('SELECT COALESCE(MAX(pos),0) as m FROM playlist_tracks WHERE playlist_id = ?').get(playlistId)?.m || 0;
  db.prepare(`
    INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, pos, added_at)
    VALUES (@playlist_id, @track_id, @pos, @added_at)
  `).run({
    playlist_id: playlistId,
    track_id: track.id,
    pos: maxPos + 1,
    added_at: now,
  });
  return true;
}

function removeTrack(userId, playlistId, trackId) {
  const db = getDb();
  const pl = getPlaylist(userId, playlistId);
  if (!pl) return null;
  const res = db.prepare('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?').run(playlistId, trackId);
  return res.changes > 0;
}

function getPlaylistWithTracks(userId, playlistId) {
  const db = getDb();
  const pl = getPlaylist(userId, playlistId);
  if (!pl) return null;
  const rows = db.prepare(`
    SELECT t.*, pt.pos
      FROM playlist_tracks pt
      JOIN tracks t ON t.id = pt.track_id
     WHERE pt.playlist_id = ?
       AND t.user_id = ?
     ORDER BY pt.pos ASC, pt.added_at ASC
  `).all(playlistId, userId);
  return {
    ...pl,
    tracks: rows.map(serializeTrack),
  };
}

module.exports = {
  createPlaylist,
  listPlaylists,
  getPlaylist,
  deletePlaylist,
  addTrack,
  removeTrack,
  getPlaylistWithTracks,
};
