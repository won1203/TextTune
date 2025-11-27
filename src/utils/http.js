function ensureFetch() {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available in this Node.js runtime.');
  }
}

module.exports = {
  ensureFetch,
};

