const fs = require('fs');
const path = require('path');
const { Client } = require('@gradio/client');
const { ensureFetch } = require('../utils/http');

const DEFAULT_SPACE_ID = (process.env.HF_SPACE_ID || '').trim();

class SpaceQuotaError extends Error {
  constructor(message, details) {
    super(message || 'Space quota exceeded');
    this.name = 'SpaceQuotaError';
    this.code = 'space_quota';
    this.details = details || null;
    this.userMessage = message || 'Space quota exceeded';
  }
}

function extensionFromContentType(contentType) {
  if (!contentType) return 'wav';
  const lowered = contentType.toLowerCase();
  if (lowered.includes('mpeg')) return 'mp3';
  if (lowered.includes('flac')) return 'flac';
  if (lowered.includes('ogg')) return 'ogg';
  if (lowered.includes('wav')) return 'wav';
  return 'wav';
}

function guessMimeFromUrl(url) {
  if (!url) return null;
  const lowered = url.toLowerCase();
  if (lowered.endsWith('.mp3')) return 'audio/mpeg';
  if (lowered.endsWith('.flac')) return 'audio/flac';
  if (lowered.endsWith('.ogg') || lowered.endsWith('.oga')) return 'audio/ogg';
  if (lowered.endsWith('.wav')) return 'audio/wav';
  return null;
}

function isDataUri(str) {
  return typeof str === 'string' && /^data:[^;]+;base64,/.test(str);
}

function decodeDataUri(uri) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(uri);
  if (!match) return null;
  return {
    buffer: Buffer.from(match[2], 'base64'),
    contentType: match[1],
    extension: extensionFromContentType(match[1]),
  };
}

function resolveUrl(resource, rootUrl) {
  if (!resource) return null;
  if (/^https?:\/\//i.test(resource)) return resource;
  if (!rootUrl) return null;
  if (resource.startsWith('/')) {
    return `${rootUrl.replace(/\/$/, '')}${resource}`;
  }
  return `${rootUrl.replace(/\/$/, '')}/${resource.replace(/^\//, '')}`;
}

function textBag(component) {
  const props = component?.props || {};
  return [
    component?.type,
    props.label,
    props.name,
    props.info,
    props.placeholder,
    props.value && typeof props.value === 'string' ? props.value : null,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matches(text, keywords) {
  return keywords.some(k => text.includes(k));
}

function defaultValue(component) {
  if (!component) return null;
  const props = component.props || {};
  if ('value' in props) return props.value;
  if (component.type === 'textbox' || component.type === 'textarea') return '';
  if (component.type === 'slider') return props.minimum ?? 0;
  if (component.type === 'checkbox') return Boolean(props.value);
  return null;
}

function clampNumber(value, { minimum, maximum }) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  let result = num;
  if (Number.isFinite(minimum)) result = Math.max(result, minimum);
  if (Number.isFinite(maximum)) result = Math.min(result, maximum);
  return result;
}

function deriveComponentValue(component, overrides, assignments) {
  const props = component?.props || {};
  const bag = textBag(component);
  const type = (component?.type || '').toLowerCase();

  if (!assignments.prompt && matches(bag, ['prompt', 'description', 'text', 'lyrics'])) {
    assignments.prompt = true;
    return overrides.prompt ?? defaultValue(component) ?? '';
  }
  if (!assignments.duration && matches(bag, ['duration', 'second', 'length', 'time', 'sec'])) {
    assignments.duration = true;
    const clamped = clampNumber(overrides.durationSec, props);
    return clamped ?? overrides.durationSec ?? defaultValue(component);
  }
  if (!assignments.samplerate && matches(bag, ['sample rate', 'samplerate', 'hz'])) {
    assignments.samplerate = true;
    return clampNumber(overrides.samplerate, props) ?? overrides.samplerate ?? defaultValue(component);
  }
  if (!assignments.seed && matches(bag, ['seed'])) {
    assignments.seed = true;
    return clampNumber(overrides.seed, props) ?? overrides.seed ?? defaultValue(component);
  }

  if (type === 'checkbox' && typeof props.value === 'boolean') return props.value;
  if (type === 'slider') {
    const base = clampNumber(props.value, props);
    return base ?? props.minimum ?? overrides.durationSec ?? defaultValue(component);
  }

  return defaultValue(component);
}

function buildPayload(dependency, components, overrides) {
  const map = new Map(components.map(c => [c.id, c]));
  const assignments = { prompt: false, duration: false, samplerate: false, seed: false };
  return (dependency.inputs || []).map(componentId => {
    const component = map.get(componentId);
    return deriveComponentValue(component, overrides, assignments);
  });
}

function selectDependency(config) {
  if (!config?.dependencies?.length) return null;
  const backendFns = config.dependencies.filter(dep => dep.backend_fn && dep.inputs?.length && dep.outputs?.length);
  const visible = backendFns.filter(dep => dep.api_name && dep.api_name !== '_check_login_status');
  const prefer = visible.find(dep => /predict|generate|run|music/i.test(dep.api_name)) || visible[0];
  return prefer || backendFns[0] || null;
}

function extractSpaceErrorMessage(err) {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error && err.message) return err.message;
  if (typeof err.message === 'string') return err.message;
  if (err.status && typeof err.status.message === 'string') return err.status.message;
  if (typeof err.detail === 'string') return err.detail;
  try {
    return JSON.stringify(err);
  } catch {
    return '';
  }
}

function isQuotaMessage(message) {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes('zerogpu') || (lower.includes('login') && lower.includes('quota'));
}

async function fetchRemoteBuffer(url, accessToken) {
  ensureFetch();
  const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    throw new Error(`Failed to download audio from Space output (${resp.status} ${resp.statusText})`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  const contentType = resp.headers.get('content-type') || guessMimeFromUrl(url) || 'audio/wav';
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
    extension: extensionFromContentType(contentType),
  };
}

async function normalizeAudioCandidate(value, context) {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const normalized = await normalizeAudioCandidate(item, context);
      if (normalized) return normalized;
    }
    return null;
  }
  if (typeof value === 'string') {
    if (isDataUri(value)) return decodeDataUri(value);
    if (/^https?:\/\//i.test(value)) return fetchRemoteBuffer(value, context.accessToken);
    const resolved = resolveUrl(value, context.root);
    if (resolved) return fetchRemoteBuffer(resolved, context.accessToken);
    return null;
  }
  if (typeof value === 'object') {
    if (typeof value.data === 'string' && isDataUri(value.data)) {
      return decodeDataUri(value.data);
    }
    if (value.url) {
      const url = resolveUrl(value.url, context.root);
      if (url) return fetchRemoteBuffer(url, context.accessToken);
    }
    if (value.path) {
      const maybeUrl = resolveUrl(`/file=${value.path}`, context.root) || resolveUrl(value.path, context.root);
      if (maybeUrl) return fetchRemoteBuffer(maybeUrl, context.accessToken);
    }
  }
  return null;
}

async function extractAudioFromResult({ dependency, components, data, root, accessToken }) {
  const map = new Map(components.map(c => [c.id, c]));
  for (let idx = 0; idx < (dependency.outputs || []).length; idx++) {
    const outputId = dependency.outputs[idx];
    const component = map.get(outputId);
    const value = Array.isArray(data) ? data[idx] : null;
    const componentType = (component?.type || '').toLowerCase();
    if (!componentType) continue;
    if (componentType.includes('audio') || componentType.includes('file') || componentType.includes('gallery')) {
      const normalized = await normalizeAudioCandidate(value, { root, accessToken });
      if (normalized) return normalized;
    }
  }
  return null;
}

async function generateSpaceAudioTrack({
  prompt,
  durationSec,
  samplerate,
  seed,
  outDir,
  filenamePrefix = 'track',
  spaceId = DEFAULT_SPACE_ID,
  accessToken = process.env.HF_API_TOKEN,
}) {
  if (!spaceId) {
    throw new Error('HF_SPACE_ID is required to call a Hugging Face Space.');
  }

  const client = await Client.connect(spaceId, {
    hf_token: accessToken || undefined,
  });

  const dependency = selectDependency(client.config);
  if (!dependency) {
    throw new Error(`Space ${spaceId} does not expose a callable backend function.`);
  }

  const payload = buildPayload(dependency, client.config?.components || [], {
    prompt,
    durationSec,
    samplerate,
    seed,
  });

  const endpointName = dependency.api_name ? `/${dependency.api_name}` : dependency.id;
  let result;
  try {
    result = await client.predict(endpointName, payload);
  } catch (err) {
    const detail = extractSpaceErrorMessage(err);
    if (isQuotaMessage(detail)) {
      throw new SpaceQuotaError(
        'HF Space ZeroGPU 무료 할당량이 모두 사용되어 Space 추론이 중단되었습니다. Hugging Face에 로그인하거나 HF_API_TOKEN을 설정해 주세요.',
        detail
      );
    }
    if (err instanceof Error) throw err;
    const generic = detail || 'HF Space 호출 중 알 수 없는 오류가 발생했습니다.';
    const error = new Error(generic);
    error.details = detail;
    throw error;
  }

  const audio = await extractAudioFromResult({
    dependency,
    components: client.config?.components || [],
    data: result?.data,
    root: client.config?.root,
    accessToken,
  });

  if (!audio) {
    throw new Error(`Space ${spaceId} did not return audio data for endpoint ${endpointName}.`);
  }

  const fileExt = audio.extension || 'wav';
  const filePath = path.join(outDir, `${filenamePrefix}.${fileExt}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(filePath, audio.buffer);

  return {
    filePath,
    contentType: audio.contentType,
    format: fileExt,
    modelId: spaceId,
  };
}

module.exports = {
  generateSpaceAudioTrack,
  SpaceQuotaError,
};
