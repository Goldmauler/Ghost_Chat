#!/usr/bin/env node
// ---------------------------------------------------------------------------
// REZO server-side cleanup. Deletes:
//   - rooms whose lastActivity is older than their ttl (default 24h; ttl -1 = never)
//   - rooms with a pre-3.0 id (REZO-XXXX) — those versions stored plaintext
//   - vaults holding plaintext items (pre-3.0)
//
// Run by .github/workflows/cleanup-rooms.yml every hour. Clients only expire a
// room when someone reopens it, so without this abandoned rooms live forever.
//
// Auth: set FIREBASE_SERVICE_ACCOUNT to a service-account JSON key for the
// project (Firebase console → Project settings → Service accounts). Admin
// tokens bypass the security rules, which block listing /rooms. Without it the
// script falls back to unauthenticated REST, which only works while the rules
// are still open.
//
// Usage: node scripts/cleanup-rooms.js [--dry-run]
// No dependencies — Node 18+ only.
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const DB = (process.env.REZO_DATABASE_URL || 'https://rezo-7f0d0-default-rtdb.firebaseio.com').replace(/\/$/, '');
const DRY_RUN = process.argv.includes('--dry-run');
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const ROOM_ID = /^REZO-[A-F0-9]{20}$/;

async function getAccessToken() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  const sa = JSON.parse(raw);
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function main() {
  const token = await getAccessToken();
  const url = (path, query = '') => {
    const q = new URLSearchParams(query);
    if (token) q.set('access_token', token);
    const qs = q.toString();
    return `${DB}/${path}.json${qs ? `?${qs}` : ''}`;
  };
  const get = async (path, query) => {
    const res = await fetch(url(path, query));
    if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status} ${await res.text()}`);
    return res.json();
  };
  const del = async (path, why) => {
    console.log(`${DRY_RUN ? '[dry-run] would delete' : 'delete'} ${path} — ${why}`);
    if (DRY_RUN) return;
    const res = await fetch(url(path), { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE ${path} → HTTP ${res.status} ${await res.text()}`);
  };

  console.log(`REZO cleanup on ${DB} (${token ? 'service account' : 'unauthenticated'})`);
  const now = Date.now();
  let deleted = 0;

  const roomIds = Object.keys((await get('rooms', { shallow: 'true' })) || {});
  for (const id of roomIds) {
    if (!ROOM_ID.test(id)) {
      await del(`rooms/${id}`, 'pre-3.0 room (plaintext)');
      deleted++;
      continue;
    }
    const lastActivity = await get(`rooms/${id}/lastActivity`);
    const ttl = await get(`rooms/${id}/ttl`);
    if (ttl === -1) continue;
    const limit = typeof ttl === 'number' && ttl > 0 ? ttl : DEFAULT_TTL_MS;
    const age = now - (typeof lastActivity === 'number' ? lastActivity : 0);
    if (age > limit) {
      await del(`rooms/${id}`, `inactive ${Math.round(age / 3_600_000)}h, ttl ${Math.round(limit / 3_600_000)}h`);
      deleted++;
    }
  }

  const vaultIds = Object.keys((await get('vaults', { shallow: 'true' })) || {});
  for (const id of vaultIds) {
    const items = (await get(`vaults/${id}/items`)) || {};
    const plaintext = Object.values(items).some((i) => i && typeof i.content === 'string');
    if (plaintext) {
      await del(`vaults/${id}`, 'pre-3.0 vault (plaintext)');
      deleted++;
    }
  }

  console.log(`${roomIds.length} room(s), ${vaultIds.length} vault(s) checked; ${deleted} ${DRY_RUN ? 'to delete' : 'deleted'}.`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
