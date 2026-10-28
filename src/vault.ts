import * as vscode from 'vscode';
import { firebaseGet, firebasePost, firebaseDelete } from './firebase';
import {
  generateRoomId,
  generateRoomKey,
  keyToString,
  keyFromString,
  encryptJson,
  decryptJson,
} from './crypto';

// ---------------------------------------------------------------------------
// Vault — personal cloud storage.
//
// Path: /vaults/{vaultId}/items/{itemId}
//
// Security: the vault is keyed by a random 80-bit `vaultId` (NOT the username,
// which is guessable) generated once per install and kept in SecretStorage.
// Every item's contents are encrypted with a per-install AES key that never
// leaves the machine, so the open database holds only ciphertext under an
// unguessable path. Items don't expire.
// ---------------------------------------------------------------------------

const SECRET_VAULT_ID = 'rezo.vaultId';
const SECRET_VAULT_KEY = 'rezo.vaultKey';

export interface VaultItem {
  id: string;
  content: string;
  language: string;
  file: string;
  line: number;
  title: string;
  timestamp: number;
}

interface VaultEnvelope {
  timestamp: number;
  ct: string;
}

export interface VaultCredentials {
  vaultId: string;
  key: Buffer;
}

/**
 * Return this install's vault id + encryption key, generating and persisting
 * them the first time. Both live only in SecretStorage.
 */
export async function getVaultCredentials(
  context: vscode.ExtensionContext
): Promise<VaultCredentials> {
  let vaultId = await context.secrets.get(SECRET_VAULT_ID);
  if (!vaultId) {
    // Reuse the room-id generator: same unguessable path-safe shape.
    vaultId = generateRoomId().replace(/^REZO-/, 'V-');
    await context.secrets.store(SECRET_VAULT_ID, vaultId);
  }

  let key = keyFromString((await context.secrets.get(SECRET_VAULT_KEY)) ?? '');
  if (!key) {
    key = generateRoomKey();
    await context.secrets.store(SECRET_VAULT_KEY, keyToString(key));
  }

  return { vaultId, key };
}

export async function saveToVault(
  creds: VaultCredentials,
  item: Omit<VaultItem, 'id' | 'timestamp'>
): Promise<string | null> {
  const envelope: VaultEnvelope = {
    timestamp: Date.now(),
    ct: encryptJson(creds.key, {
      content: item.content,
      language: item.language,
      file: item.file,
      line: item.line,
      title: item.title,
    }),
  };
  return firebasePost(`vaults/${creds.vaultId}/items`, envelope);
}

export async function listVault(creds: VaultCredentials): Promise<VaultItem[]> {
  const raw = (await firebaseGet(`vaults/${creds.vaultId}/items`)) as Record<
    string,
    VaultEnvelope
  > | null;

  if (!raw || typeof raw !== 'object') return [];

  const items: VaultItem[] = [];
  for (const [id, env] of Object.entries(raw)) {
    if (!env || typeof env.timestamp !== 'number' || typeof env.ct !== 'string') {
      continue;
    }
    const inner = decryptJson<{
      content?: string;
      language?: string;
      file?: string;
      line?: number;
      title?: string;
    }>(creds.key, env.ct);
    if (!inner) continue;
    items.push({
      id,
      content: inner.content ?? '',
      language: inner.language ?? 'plaintext',
      file: inner.file ?? '',
      line: inner.line ?? 0,
      title: inner.title ?? (inner.content ?? '').slice(0, 60),
      timestamp: env.timestamp,
    });
  }

  items.sort((a, b) => b.timestamp - a.timestamp);
  return items;
}

export async function deleteVaultItem(
  creds: VaultCredentials,
  itemId: string
): Promise<void> {
  await firebaseDelete(`vaults/${creds.vaultId}/items/${itemId}`);
}

export function generateTitle(content: string): string {
  const firstLine = content.split('\n').find((l) => l.trim().length > 0) ?? '';
  const trimmed = firstLine.trim().slice(0, 60);
  return trimmed || 'Untitled';
}
