// ---------------------------------------------------------------------------
// REZO shared config — Firebase backend coordinates + presence tuning.
//
// SECURITY NOTE — read before changing:
//   The Firebase apiKey/databaseURL below are project *coordinates*, not
//   secrets: Firebase API keys are designed to ship in clients. REZO does not
//   rely on their secrecy — room contents are end-to-end encrypted (see
//   crypto.ts) so the database only ever stores ciphertext, and the deployed
//   security rules (database.rules.json) block enumeration of `/rooms`.
//
//   Do NOT add any provider secret (Groq / Gemini / DeepSeek keys) here. Those
//   are user-supplied and live in VS Code SecretStorage only. A shipped AI key
//   would be world-readable inside the .vsix and abused — that is why the old
//   BUILT_IN_GROQ_KEY was removed.
// ---------------------------------------------------------------------------

export interface FirebaseConfig {
  apiKey?: string;
  authDomain?: string;
  databaseURL?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

export const FIREBASE_CONFIG: FirebaseConfig = {
  apiKey: 'AIzaSyClCzypuFujzHjdnqAatT1A2C_D6DLWWPU',
  authDomain: 'rezo-7f0d0.firebaseapp.com',
  databaseURL: 'https://rezo-7f0d0-default-rtdb.firebaseio.com',
  projectId: 'rezo-7f0d0',
  storageBucket: 'rezo-7f0d0.firebasestorage.app',
  messagingSenderId: '737617221120',
  appId: '1:737617221120:web:f21df43b10917b3da02ae5'
};

// Presence heartbeat interval (ms). A client is considered "online" if its
// presence record is younger than 2.5x this value.
export const PRESENCE_HEARTBEAT_MS = 20_000;
export const PRESENCE_STALE_MS = 50_000;
