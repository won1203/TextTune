const { initDb, DB_PATH } = require('./connection');

initDb();
// eslint-disable-next-line no-console
console.log(`SQLite DB initialized at ${DB_PATH}`);
