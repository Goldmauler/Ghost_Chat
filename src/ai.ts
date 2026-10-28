import * as https from 'https';
import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Strict system prompt — direct answers only, no filler
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  'You are a direct assistant. ' +
  'Answer ONLY what is asked. Nothing else. ' +
  'No explanations, no reasoning, no "here\'s how", no "I hope this helps". ' +
  'No markdown unless the answer itself is code. ' +
  'If the input is code, respond with corrected/improved code only. ' +
  'If the input is a question, answer in as few words as possible. ' +
  'Only explain if the user explicitly uses words like "explain", "why", "how does". ' +
  'Never start with "Sure", "Of course", "Great question", "Certainly" or any filler. ' +
  'Just the answer. Raw. Direct.';

// ---------------------------------------------------------------------------
// Slash command system — specialized prompts based on input prefix
// ---------------------------------------------------------------------------

interface SlashCommand {
  trigger: string;
  systemPrompt: string;
  description: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    trigger: '/explain',
    description: 'Explain what code does',
    systemPrompt:
      'Explain the given code clearly and concisely. ' +
      'Cover what it does, key logic, and any non-obvious behavior. ' +
      'No markdown headers. Plain explanatory text. ' +
      'Be precise — no filler words like "essentially", "basically", "as you can see".'
  },
  {
    trigger: '/test',
    description: 'Generate test cases',
    systemPrompt:
      'Generate unit tests for the given code. ' +
      'Use the appropriate test framework for the language. ' +
      'Cover happy path, edge cases, and error cases. ' +
      'Output ONLY the test code. No explanation. No markdown fences.'
  },
  {
    trigger: '/refactor',
    description: 'Improve code quality',
    systemPrompt:
      'Refactor the given code for better readability, performance, and idiomatic style. ' +
      'Preserve exact behavior. ' +
      'Output ONLY the refactored code. No explanation. No markdown fences. ' +
      'No comments unless they were in the original or are critical.'
  },
  {
    trigger: '/fix',
    description: 'Fix bugs',
    systemPrompt:
      'Find and fix bugs in the given code. ' +
      'Output the corrected code only. ' +
      'No explanation. No markdown fences. ' +
      'If no bugs are found, output the original code unchanged.'
  }
];

/**
 * Detect a slash command at the start of the input.
 * Returns the matched command and the prompt with trigger stripped, or null.
 */
export function parseSlashCommand(input: string): {
  command: SlashCommand | null;
  prompt: string;
} {
  const trimmed = input.trim();

  for (const cmd of SLASH_COMMANDS) {
    if (trimmed.toLowerCase().startsWith(cmd.trigger)) {
      // Strip the trigger and any leading whitespace
      const remaining = trimmed.slice(cmd.trigger.length).trim();
      return { command: cmd, prompt: remaining || trimmed };
    }
  }

  return { command: null, prompt: trimmed };
}

export function getSlashCommands(): SlashCommand[] {
  return SLASH_COMMANDS;
}

// ---------------------------------------------------------------------------
// Rate limit error detection
// ---------------------------------------------------------------------------

function isRateLimitError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('rate limit') ||
    lower.includes('quota') ||
    lower.includes('too many requests') ||
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('ratelimitexceeded')
  );
}

// ---------------------------------------------------------------------------
// Generic HTTPS POST helper
// ---------------------------------------------------------------------------

function httpsPost(
  hostname: string,
  path: string,
  headers: Record<string, string>,
  body: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve(data));
    });

    req.on('error', (err: Error) => reject(new Error(`Network error: ${err.message}`)));
    req.write(body);
    req.end();
  });
}

// Model ids are user-configurable (rezo.geminiModel etc.) because providers
// retire models often — a hardcoded id silently breaks Ask AI for everyone.
function modelSetting(key: string, fallback: string): string {
  const v = vscode.workspace.getConfiguration('rezo').get<string>(key);
  return v && v.trim() ? v.trim() : fallback;
}

// ---------------------------------------------------------------------------
// Provider 1: Gemini (google)
// ---------------------------------------------------------------------------

const GEMINI_HOST = 'generativelanguage.googleapis.com';
const GEMINI_MODEL = 'gemini-flash-latest'; // Google-maintained alias for the current Flash model

export async function askGemini(prompt: string, apiKey: string, sys: string = SYSTEM_PROMPT): Promise<string> {
  const body = JSON.stringify({
    system_instruction: { parts: [{ text: sys }] },
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
  });

  const model = modelSetting('geminiModel', GEMINI_MODEL);
  const path = `/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const raw = await httpsPost(GEMINI_HOST, path, { 'x-goog-api-key': apiKey }, body);

  const parsed = JSON.parse(raw) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string; status?: string };
  };

  if (parsed.error) {
    const msg = parsed.error.message ?? 'Gemini error';
    throw new Error(isRateLimitError(msg) ? `RATE_LIMIT:${msg}` : msg);
  }

  const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('No response from Gemini');
  return text.trim();
}

// ---------------------------------------------------------------------------
// Provider 2: DeepSeek (OpenAI-compatible API)
// ---------------------------------------------------------------------------

const DEEPSEEK_HOST = 'api.deepseek.com';
const DEEPSEEK_MODEL = 'deepseek-chat';

export async function askDeepSeek(prompt: string, apiKey: string, sys: string = SYSTEM_PROMPT): Promise<string> {
  const body = JSON.stringify({
    model: modelSetting('deepseekModel', DEEPSEEK_MODEL),
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1,
    max_tokens: 1024
  });

  const raw = await httpsPost(
    DEEPSEEK_HOST,
    '/v1/chat/completions',
    { Authorization: `Bearer ${apiKey}` },
    body
  );

  const parsed = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string; type?: string };
  };

  if (parsed.error) {
    const msg = parsed.error.message ?? 'DeepSeek error';
    throw new Error(isRateLimitError(msg) ? `RATE_LIMIT:${msg}` : msg);
  }

  const text = parsed.choices?.[0]?.message?.content;
  if (!text) throw new Error('No response from DeepSeek');
  return text.trim();
}

// ---------------------------------------------------------------------------
// Provider 3: Groq (OpenAI-compatible API, very fast)
// ---------------------------------------------------------------------------

const GROQ_HOST = 'api.groq.com';
const GROQ_MODEL = 'llama-3.1-8b-instant';

export async function askGroq(prompt: string, apiKey: string, sys: string = SYSTEM_PROMPT): Promise<string> {
  const body = JSON.stringify({
    model: modelSetting('groqModel', GROQ_MODEL),
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1,
    max_tokens: 1024
  });

  const raw = await httpsPost(
    GROQ_HOST,
    '/openai/v1/chat/completions',
    { Authorization: `Bearer ${apiKey}` },
    body
  );

  const parsed = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string; type?: string };
  };

  if (parsed.error) {
    const msg = parsed.error.message ?? 'Groq error';
    throw new Error(isRateLimitError(msg) ? `RATE_LIMIT:${msg}` : msg);
  }

  const text = parsed.choices?.[0]?.message?.content;
  if (!text) throw new Error('No response from Groq');
  return text.trim();
}

// ---------------------------------------------------------------------------
// API key storage helpers — one per provider
// ---------------------------------------------------------------------------

const KEY_NAMES = {
  gemini:   'rezo.geminiApiKey',
  deepseek: 'rezo.deepseekApiKey',
  groq:     'rezo.groqApiKey'
} as const;

type Provider = keyof typeof KEY_NAMES;

export async function getApiKey(
  context: vscode.ExtensionContext,
  provider: Provider
): Promise<string | undefined> {
  const secretKey = KEY_NAMES[provider];

  // Try secure secrets first
  const secret = await context.secrets.get(secretKey);
  if (secret && secret.trim()) return secret.trim();

  // Fall back to settings
  const fromSettings = vscode.workspace
    .getConfiguration('rezo')
    .get<string>(provider === 'gemini' ? 'geminiApiKey' :
                  provider === 'deepseek' ? 'deepseekApiKey' : 'groqApiKey');

  if (fromSettings && fromSettings.trim()) return fromSettings.trim();
  return undefined;
}

export async function storeApiKey(
  context: vscode.ExtensionContext,
  provider: Provider,
  apiKey: string
): Promise<void> {
  await context.secrets.store(KEY_NAMES[provider], apiKey.trim());
}

// Keep backward compat exports
export async function getGeminiApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
  return getApiKey(context, 'gemini');
}

export async function storeGeminiApiKey(context: vscode.ExtensionContext, apiKey: string): Promise<void> {
  return storeApiKey(context, 'gemini', apiKey);
}

// ---------------------------------------------------------------------------
// Main entry: askAI with automatic fallback chain
// Gemini → DeepSeek → Groq
// Falls back only on rate limit errors, not on auth/config errors
// ---------------------------------------------------------------------------

export async function askAIWithFallback(
  prompt: string,
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel,
  systemPromptOverride?: string
): Promise<{ answer: string; provider: string }> {

  // Provider chain is built entirely from user-supplied keys. REZO ships NO
  // built-in AI key — a shipped key lives in the world-readable .vsix and gets
  // abused. Order: Gemini → DeepSeek → Groq, whichever the user has configured.
  const userGeminiKey   = await getApiKey(context, 'gemini');
  const userDeepseekKey = await getApiKey(context, 'deepseek');
  const userGroqKey     = await getApiKey(context, 'groq');

  const sys = systemPromptOverride ?? SYSTEM_PROMPT;

  const chain: Array<{
    name: string;
    key: string;
    fn: (p: string, k: string, sys: string) => Promise<string>
  }> = [];

  if (userGeminiKey)   chain.push({ name: 'Gemini',   key: userGeminiKey,   fn: askGemini });
  if (userDeepseekKey) chain.push({ name: 'DeepSeek', key: userDeepseekKey, fn: askDeepSeek });
  if (userGroqKey)     chain.push({ name: 'Groq',     key: userGroqKey,     fn: askGroq });

  if (chain.length === 0) {
    throw new Error(
      'No AI key set. Run "REZO: Set AI Keys" to add a free Gemini, DeepSeek, or Groq key.'
    );
  }

  let lastError = '';

  for (const provider of chain) {
    try {
      outputChannel.appendLine(`[REZO AI] Trying ${provider.name}…`);
      const answer = await provider.fn(prompt, provider.key, sys);
      outputChannel.appendLine(`[REZO AI] ${provider.name} answered.`);
      return { answer, provider: provider.name };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;

      if (msg.startsWith('RATE_LIMIT:')) {
        outputChannel.appendLine(
          `[REZO AI] ${provider.name} rate limited, trying next provider…`
        );
        continue;
      }

      throw new Error(`${provider.name}: ${msg}`);
    }
  }

  throw new Error(
    `All AI providers are rate limited. Try again in a minute. (${lastError})`
  );
}
