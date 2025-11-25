const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', '..', 'storage', 'texttune.db');

let dbInstance = null;

function initDb() {
  if (dbInstance) return dbInstance;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      picture TEXT,
      auth_provider TEXT,
      plan TEXT DEFAULT 'free',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      prompt_raw TEXT,
      prompt_expanded TEXT,
      params TEXT,
      status TEXT NOT NULL,
      progress REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      finished_at TEXT,
      error_code TEXT,
      error TEXT,
      result_track_id TEXT,
      audio_url TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      job_id TEXT,
      duration REAL,
      samplerate INTEGER,
      bitrate INTEGER,
      format TEXT,
      storage_key_original TEXT NOT NULL,
      storage_key_mp3 TEXT,
      public INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      prompt_raw TEXT,
      prompt_expanded TEXT,
      params TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES generation_jobs(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_user_created_at ON tracks(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_jobs_user_created_at ON generation_jobs(user_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  dbInstance = db;
  return dbInstance;
}

function getDb() {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return dbInstance;
}

module.exports = {
  initDb,
  getDb,
  DB_PATH,
};
