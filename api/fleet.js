import { put, head, list } from '@vercel/blob';
import { createHash, randomBytes } from 'crypto';

// ═══ CONFIG ═══
const MAX_FLEET_SIZE = 512 * 1024; // 512KB max per fleet
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,28}[a-z0-9]$/; // 2-30 chars

// ═══ HELPERS ═══
function blobPath(slug) {
  return `fleets/${slug}.json`;
}

function hashKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

function generateEditKey() {
  return randomBytes(12).toString('hex'); // 24 hex chars
}

function sendJson(res, data, status = 200) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).json(data);
}

function sendError(res, message, status = 400) {
  sendJson(res, { ok: false, error: message }, status);
}

// ═══ READ a fleet ═══
async function handleGet(res, slug) {
  if (!slug || !SLUG_RE.test(slug)) {
    return sendError(res, 'Invalid slug. Use 2-30 lowercase letters, numbers, or hyphens.');
  }

  try {
    // List blobs with the exact path prefix
    const { blobs } = await list({ prefix: blobPath(slug) });
    const blob = blobs.find(b => b.pathname === blobPath(slug));
    if (!blob) return sendError(res, 'Fleet not found', 404);

    // Fetch the actual content
    const fetchRes = await fetch(blob.url);
    const stored = await fetchRes.json();

    return sendJson(res, {
      ok: true,
      slug,
      data: stored.data,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    });
  } catch (e) {
    console.error('GET error:', e);
    return sendError(res, 'Fleet not found', 404);
  }
}

// ═══ CREATE a fleet ═══
async function handlePost(res, body) {
  const { slug, editKey: customEditKey, data } = body;

  if (!slug || !SLUG_RE.test(slug)) {
    return sendError(res, 'Invalid slug. Use 2-30 lowercase letters, numbers, or hyphens. Must start and end with a letter or number.');
  }
  if (!data || !data.properties) {
    return sendError(res, 'Missing fleet data (needs properties array)');
  }

  const dataStr = JSON.stringify(data);
  if (dataStr.length > MAX_FLEET_SIZE) {
    return sendError(res, `Fleet too large (${Math.round(dataStr.length / 1024)}KB, max ${MAX_FLEET_SIZE / 1024}KB)`);
  }

  // Check if slug is taken
  try {
    const { blobs } = await list({ prefix: blobPath(slug) });
    if (blobs.some(b => b.pathname === blobPath(slug))) {
      return sendError(res, `"${slug}" is already taken. Pick a different name.`, 409);
    }
  } catch (e) {
    // If list fails, continue — we'll overwrite check on put
  }

  // Generate or validate edit key
  const editKey = customEditKey || generateEditKey();
  if (editKey.length < 4) return sendError(res, 'Edit key must be at least 4 characters');
  if (editKey.length > 64) return sendError(res, 'Edit key must be 64 characters or fewer');

  const stored = {
    editKeyHash: hashKey(editKey),
    data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await put(blobPath(slug), JSON.stringify(stored), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });

  return sendJson(res, {
    ok: true,
    slug,
    editKey,
    viewUrl: `/cars?${slug}`,
    editUrl: `/cars?${slug}&edit=${encodeURIComponent(editKey)}`,
  }, 201);
}

// ═══ UPDATE a fleet ═══
async function handlePut(res, slug, body) {
  if (!slug || !SLUG_RE.test(slug)) return sendError(res, 'Invalid slug');

  const { editKey, data } = body;
  if (!editKey) return sendError(res, 'Missing edit key');
  if (!data || !data.properties) return sendError(res, 'Missing fleet data');

  const dataStr = JSON.stringify(data);
  if (dataStr.length > MAX_FLEET_SIZE) {
    return sendError(res, `Fleet too large (${Math.round(dataStr.length / 1024)}KB)`);
  }

  // Load existing
  let stored;
  try {
    const { blobs } = await list({ prefix: blobPath(slug) });
    const blob = blobs.find(b => b.pathname === blobPath(slug));
    if (!blob) return sendError(res, 'Fleet not found', 404);
    const fetchRes = await fetch(blob.url);
    stored = await fetchRes.json();
  } catch (e) {
    return sendError(res, 'Fleet not found', 404);
  }

  // Verify edit key
  if (hashKey(editKey) !== stored.editKeyHash) {
    return sendError(res, 'Invalid edit key', 403);
  }

  // Update
  stored.data = data;
  stored.updatedAt = new Date().toISOString();

  await put(blobPath(slug), JSON.stringify(stored), {
    access: 'public',
    contentType: 'application/json',
    addRandomSuffix: false,
  });

  return sendJson(res, { ok: true, slug, updatedAt: stored.updatedAt });
}

// ═══ MAIN HANDLER ═══
export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  const slug = (req.query.slug || '').toLowerCase().trim();

  try {
    if (req.method === 'GET') {
      return await handleGet(res, slug);
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      body.slug = (body.slug || '').toLowerCase().trim();
      return await handlePost(res, body);
    }
    if (req.method === 'PUT') {
      return await handlePut(res, slug, req.body || {});
    }
    return sendError(res, 'Method not allowed', 405);
  } catch (e) {
    console.error('Fleet API error:', e);
    return sendError(res, 'Internal server error', 500);
  }
}
