const fs = require('fs');
const path = require('path');

function hashStringToInt(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return Math.abs(h >>> 0);
}

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// Simple stereo WAV writer (16-bit PCM)
function writeWav({ filePath, durationSec = 12, sampleRate = 44100, channels = 2, renderFn }) {
  const bitsPerSample = 16;
  const totalSamples = Math.floor(durationSec * sampleRate);
  const blockAlign = (channels * bitsPerSample) / 8; // bytes per frame
  const byteRate = sampleRate * blockAlign;
  const dataBytes = totalSamples * blockAlign;
  const headerBytes = 44;
  const buffer = Buffer.alloc(headerBytes + dataBytes);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // PCM chunk size
  buffer.writeUInt16LE(1, 20); // PCM format
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);

  let offset = headerBytes;
  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const frame = renderFn(t, i);
    // frame = { left, right } in [-1, 1]
    const l = Math.max(-1, Math.min(1, frame.left));
    const r = Math.max(-1, Math.min(1, frame.right));
    buffer.writeInt16LE((l * 32767) | 0, offset);
    buffer.writeInt16LE((r * 32767) | 0, offset + 2);
    offset += 4;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buffer);
  return { filePath, sampleRate, channels, bitsPerSample, durationSec };
}

// Generate a simple synth-pop-ish motif using seed and prompt hash.
function synthesizeWav({ prompt, seed = 0, durationSec = 12, sampleRate = 44100, outPath }) {
  const seedInt = (seed || 0) + hashStringToInt(prompt || '');
  const rnd = lcg(seedInt);

  // Choose a key (base frequency) and a small set of intervals
  const baseFreq = 220 * Math.pow(2, Math.floor(rnd() * 12) / 12); // A3-ish
  const scale = [0, 2, 4, 5, 7, 9, 11, 12]; // major scale semitones
  const bpm = 100 + Math.floor(rnd() * 40); // 100-140
  const beatSec = 60 / bpm;

  const motif = Array.from({ length: 8 }, () => scale[Math.floor(rnd() * scale.length)]);

  const renderFn = (t) => {
    // Section changes every 2 bars
    const bars = Math.floor(t / (beatSec * 4));
    const motifIdx = Math.floor((t / (beatSec / 2)) % motif.length);
    const semis = motif[motifIdx] + (bars % 2 === 0 ? 0 : 12); // octave up every other section
    const freqLead = baseFreq * Math.pow(2, semis / 12);
    const freqBass = baseFreq / 2;

    const lead = Math.sin(2 * Math.PI * freqLead * t);
    const bass = Math.sign(Math.sin(2 * Math.PI * freqBass * t)); // square-ish bass
    const arp = Math.sin(2 * Math.PI * (freqLead * 1.5) * t);

    // Envelope (attack/decay)
    const attack = 0.02, decay = 0.3;
    const local = (t / (beatSec / 2)) % 1; // per-note
    const env = local < attack ? local / attack : Math.max(0, 1 - (local - attack) / decay);

    // Subtle chorus between channels
    const l = 0.55 * env * (0.7 * lead + 0.3 * arp) + 0.25 * bass;
    const r = 0.55 * env * (0.7 * Math.sin(2 * Math.PI * freqLead * (t + 0.002)) + 0.3 * arp) + 0.25 * bass;

    // Gentle limiter
    return { left: Math.tanh(l), right: Math.tanh(r) };
  };

  return writeWav({ filePath: outPath, durationSec, sampleRate, channels: 2, renderFn });
}

module.exports = { synthesizeWav };

