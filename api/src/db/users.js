const { v4: uuidv4 } = require('uuid');
const { getDb } = require('./connection');

function serializeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name || '',
    picture: row.picture || '',
    auth_provider: row.auth_provider || '',
    plan: row.plan || 'free',
    created_at: row.created_at,
  };
}

function findById(id) {
  if (!id) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return serializeUser(row);
}

function findByEmail(email) {
  if (!email) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  return serializeUser(row);
}

function findOrCreateByEmail(email) {
  if (!email) return null;
  const existing = findByEmail(email);
  if (existing) return existing;

  const db = getDb();
  const now = new Date().toISOString();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO users (id, email, name, picture, auth_provider, plan, created_at)
    VALUES (@id, @email, @name, @picture, @auth_provider, @plan, @created_at)
  `).run({
    id,
    email,
    name: '',
    picture: '',
    auth_provider: 'dev',
    plan: 'free',
    created_at: now,
  });
  return serializeUser({ id, email, name: '', picture: '', auth_provider: 'dev', plan: 'free', created_at: now });
}

function upsertGoogleProfile({ sub, email, name, picture }) {
  if (!sub || !email) throw new Error('Google profile missing sub or email');
  const db = getDb();
  const providerId = `google-${sub}`;

  const existingById = db.prepare('SELECT * FROM users WHERE id = ?').get(providerId);
  const existingByEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const target = existingById || existingByEmail;

  if (!target) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (id, email, name, picture, auth_provider, plan, created_at)
      VALUES (@id, @email, @name, @picture, @auth_provider, @plan, @created_at)
    `).run({
      id: providerId,
      email,
      name: name || '',
      picture: picture || '',
      auth_provider: 'google',
      plan: 'free',
      created_at: now,
    });
    return serializeUser({ id: providerId, email, name, picture, auth_provider: 'google', plan: 'free', created_at: now });
  }

  db.prepare(`
    UPDATE users
      SET email = @email,
          name = COALESCE(@name, name),
          picture = COALESCE(@picture, picture),
          auth_provider = COALESCE(@auth_provider, auth_provider),
          plan = COALESCE(plan, 'free')
      WHERE id = @id
  `).run({
    id: target.id,
    email,
    name: name || target.name || '',
    picture: picture || target.picture || '',
    auth_provider: 'google',
  });

  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(target.id);
  return serializeUser(updated);
}

module.exports = {
  findById,
  findByEmail,
  findOrCreateByEmail,
  upsertGoogleProfile,
};
