function parseJsonColumn(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function toJsonColumn(value) {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return JSON.stringify({});
  }
}

module.exports = {
  parseJsonColumn,
  toJsonColumn,
};
