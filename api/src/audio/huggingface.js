const fs = require('fs');
const path = require('path');

const FALLBACK_MODEL_ID = 'stabilityai/stable-audio-open-1.0';
const HF_ROUTER_TEMPLATE = 'https://router.huggingface.co/hf-inference/models/{model}';

const STABLE_AUDIO_MODEL_ID = (() => {
  const configured = (process.env.HF_MODEL_ID || '').trim();
  return configured || FALLBACK_MODEL_ID;
})();

function resolveApiUrl(modelId) {
  const endpoint = (process.env.HF_INFERENCE_ENDPOINT || '').trim();
  if (endpoint) return endpoint;

  const base = (process.env.HF_API_URL || '').trim();
  if (!base || base === 'default') {
    return HF_ROUTER_TEMPLATE.replace('{model}', modelId);
  }
  if (base.includes('{model}')) return base.replace('{model}', modelId);
  if (base.includes('/models/')) {
    return base.endsWith(modelId) ? base : `${base.replace(/\/+$/, '')}/${modelId}`;
  }
  return `${base.replace(/\/+$/, '')}/models/${modelId}`;
}

const DEFAULT_API_URL = resolveApiUrl(STABLE_AUDIO_MODEL_ID);

function ensureFetch() {
  if (typeof fetch !== 'function') {
    throw new Error('Global fetch is not available in this Node.js runtime. Upgrade to Node 18+ or polyfill fetch.');
  }
}

function extensionFromContentType(contentType) {
  if (!contentType) return 'mp3';
  if (contentType.includes('wav')) return 'wav';
  if (contentType.includes('mpeg')) return 'mp3';
  if (contentType.includes('flac')) return 'flac';
  if (contentType.includes('ogg')) return 'ogg';
  return 'mp3';
}

function normalizeSamplerate(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 44100;
  return Math.min(48000, Math.max(8000, Math.round(num)));
}

function buildStableAudioParameters({ durationSec, seed, samplerate }) {
  const seconds = Number(durationSec);
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 12;
  const params = {
    seconds_total: safeSeconds,
    audio_end_seconds: safeSeconds,
    sample_rate: normalizeSamplerate(samplerate),
  };
  if (typeof seed === 'number') params.seed = seed;
  return params;
}

async function callStableAudioInference({
  prompt,
  durationSec = 12,
  seed = null,
  samplerate = 44100,
  modelId = STABLE_AUDIO_MODEL_ID,
  apiUrl = DEFAULT_API_URL,
  accessToken,
  abortSignal,
}) {
  ensureFetch();
  if (!accessToken) {
    throw new Error('HF_API_TOKEN is required to call Hugging Face Inference API.');
  }

  const resolvedUrl = apiUrl.includes('{model}') ? apiUrl.replace('{model}', modelId) : apiUrl;
  const isEndpoint = resolvedUrl.includes('aws.endpoints.huggingface.cloud') || resolvedUrl.includes('hf.space');
  const includeModelField = isEndpoint || !resolvedUrl.includes('/models/');

  const body = {
    inputs: prompt,
    parameters: buildStableAudioParameters({ durationSec, seed, samplerate }),
    options: { wait_for_model: true },
  };
  if (includeModelField) {
    body.model = modelId;
  }
  const payloadJson = JSON.stringify(body);

  async function requestWithRetry(url, payloadJson, maxRetries = 3) {
    let attempt = 0;
    let resp;
    while (attempt <= maxRetries) {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/octet-stream, audio/*, */*',
        },
        body: payloadJson,
        signal: abortSignal,
      });
      if (resp.ok) return resp;
      if (resp.status === 503 || resp.status === 429) {
        // backoff; try to honor estimated_time if provided
        let waitMs = 1500 * Math.pow(2, attempt);
        try {
          const j = await resp.clone().json();
          if (typeof j.estimated_time === 'number') {
            waitMs = Math.max(waitMs, Math.ceil(j.estimated_time * 1000));
          }
        } catch (_) {}
        await new Promise(r => setTimeout(r, waitMs));
        attempt++;
        continue;
      }
      break; // for other status codes, stop retrying
    }
    return resp;
  }

  const response = await requestWithRetry(resolvedUrl, payloadJson);

  if (!response.ok) {
    let errDetail = `${response.status} ${response.statusText}`;
    try {
      const errorJson = await response.json();
      errDetail = JSON.stringify(errorJson);
    } catch (_) {
      try {
        const text = await response.text();
        if (text) errDetail = text;
      } catch (_) {}
    }
    throw new Error(`Hugging Face inference failed via ${resolvedUrl}: ${errDetail}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const contentType = response.headers.get('content-type') || 'audio/mpeg';
  const extension = extensionFromContentType(contentType);

  return { buffer, contentType, extension, modelId };
}

async function generateStableAudioTrack({
  prompt,
  durationSec,
  samplerate,
  seed,
  outDir,
  filenamePrefix = 'track',
  accessToken = process.env.HF_API_TOKEN,
  modelId = STABLE_AUDIO_MODEL_ID,
  apiUrl = DEFAULT_API_URL,
}) {
  const result = await callStableAudioInference({
    prompt,
    durationSec,
    samplerate,
    seed,
    modelId,
    apiUrl,
    accessToken,
  });

  const ext = result.extension || 'mp3';
  const fileName = `${filenamePrefix}.${ext}`;
  const filePath = path.join(outDir, fileName);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(filePath, result.buffer);

  return {
    filePath,
    contentType: result.contentType,
    format: ext,
    modelId: result.modelId,
  };
}

module.exports = {
  callStableAudioInference,
  generateStableAudioTrack,
};
