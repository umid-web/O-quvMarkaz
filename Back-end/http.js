export const BODY_LIMIT = 2 * 1024 * 1024;

export const json = (res, status, value, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(value));
};

export const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

export const parseCookies = (header = '') => {
  const cookies = Object.create(null);
  const duplicates = new Set();
  for (const part of header.split(';')) {
    const [key, value] = part.trim().split(/=(.*)/s, 2);
    if (!key || value === undefined) continue;
    if (Object.hasOwn(cookies, key)) duplicates.add(key);
    cookies[key] = value;
  }
  // Ambiguous cookie paths/domains must not choose an attacker-controlled token.
  for (const key of duplicates) delete cookies[key];
  return cookies;
};

function checkJsonDepth(text) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') {
      if (++depth > 40) throw new Error('JSON nesting too deep');
    } else if (char === '}' || char === ']') depth -= 1;
  }
}

export async function readBody(req) {
  if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') throw fail(415, 'unsupported_encoding', 'Compressed request bodies are not supported.');
  if (Number(req.headers['content-length']) > BODY_LIMIT) throw fail(413, 'payload_too_large', 'Request body is too large.');
  if (!(req.headers['content-type'] || '').split(';')[0].trim().match(/^application\/json$/i)) {
    throw fail(415, 'unsupported_media_type', 'Content-Type must be application/json.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw fail(413, 'payload_too_large', 'So\'rov hajmi ruxsat etilgan chegaradan oshdi.');
    chunks.push(chunk);
  }
  if (!size) { req.assertAuthorized?.(); return {}; }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    checkJsonDepth(text);
    let nodes = 0;
    const body = JSON.parse(text, (key, value) => {
      if (++nodes > 100_000) throw new Error('JSON contains too many values');
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite JSON number');
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('Unsafe object key');
      return value;
    });
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body');
    // Recheck authorization after a potentially slow upload has completed.
    req.assertAuthorized?.();
    return body;
  } catch (error) { if (error.status) throw error; throw fail(400, 'invalid_json', 'JSON formati noto\'g\'ri.'); }
}
