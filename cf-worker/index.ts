/**
 * cf-worker/index.ts — the Cloudflare Worker entry for the kamiko.fun deploy.
 *
 * WHY THIS EXISTS. The site shipped as a pure static-assets Worker (wrangler.toml had only
 * `[assets]`), so there was no live `/api/chat` at the origin. amica's preflight chat backend POSTs
 * every turn to same-origin `/api/chat`, got a 404, and fell back to the honest but mute
 * "my full voice opens at launch…" line — the whole pitch (a talking, market-reacting VTuber)
 * degraded to a coming-soon teaser. This Worker IS that endpoint. With it, kamiko.fun's avatar
 * actually talks.
 *
 * NOT THE SAME FILE AS `worker/index.js`. That one is amica's next-pwa *service worker* (push
 * notifications, compiled into /sw.js). THIS is the Cloudflare *edge* Worker that fronts the whole
 * origin: it answers `/api/chat` (and optionally proxies the funnel), and hands everything else to
 * the static assets via the ASSETS binding. Two different runtimes, two different jobs.
 *
 * TWO WAYS TO GIVE HER A BRAIN (both owner-gated on a secret; neither invents anything):
 *
 *   1. NPC_BRIDGE_ORIGIN — a deployed services/bridge origin. When set, `/api/chat` proxies the
 *      conversation to `${origin}/v1/chat/completions` (the FULL experience: persona + guardrails +
 *      moderation + live market context + per-fan memory + emotion tag), and the funnel routes
 *      (/market, /leaderboard, …) proxy there too so MarketHud and the board light up same-origin.
 *      This is the option to prefer once the bridge is running.
 *
 *   2. ANTHROPIC_API_KEY — no bridge required. `/api/chat` calls Anthropic directly with the SAME
 *      $KAMIKO persona + guardrails this repo defines (mirrored below from
 *      services/agent-runtime/src/character.ts) plus a best-effort LIVE NVDAX quote so she still
 *      reacts to the tape, and the emotion tag so her face moves. This makes the avatar talk with a
 *      single secret and no extra infra — the fastest path to a real headline experience.
 *
 * When NEITHER is set the endpoint answers 503 `{error:'chat_not_configured'}`, which is exactly
 * what preflightChat.ts treats as "degrade to the honest pre-launch line" — so an unconfigured
 * deploy behaves precisely as it does today, never worse.
 *
 * OWNER STEPS (pick one; nothing here fabricates a key or an origin):
 *   wrangler secret put ANTHROPIC_API_KEY            # option 2 — direct brain, no bridge
 *   # or
 *   wrangler secret put NPC_BRIDGE_ORIGIN            # option 1 — full bridge; e.g. https://bridge.kamiko.fun
 *   # then, to light up the ticker/board through the same origin, set in package.json build:site:
 *   #   NEXT_PUBLIC_NPC_API=https://kamiko.fun
 *
 * SEPARATE, OPTIONAL BRAIN — GET /api/reaction (see cf-worker/marketReaction.ts): on a ±5% tape
 * crossing the stage asks this endpoint for a SPOKEN reaction and Kamiko finally says something about
 * the move (today the crossing only throws a mute pose). Jev PICKS the reaction from code-supplied
 * candidates (tone + line + hype) when its secret is set; without it a deterministic in-code rule
 * picks, so the endpoint always returns a real, in-character line — never a stub or a fabricated one.
 *   wrangler secret put TYPESAFE_API_KEY             # optional — Jev picks her market reaction
 */

import { chooseReaction } from './marketReaction';

// ── Env ──────────────────────────────────────────────────────────────────────────────────────
// Minimal hand-rolled types so this file needs no @cloudflare/workers-types dependency (disk is
// tight; wrangler bundles this with esbuild, which never type-checks). It is excluded from the
// Next app's tsconfig for the same reason.
interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}
interface Env {
  ASSETS: AssetFetcher;
  /** A deployed services/bridge origin. Set → /api/chat + funnel proxy through the real bridge. */
  NPC_BRIDGE_ORIGIN?: string;
  /** Anthropic key → direct in-character chat when no bridge is configured. */
  ANTHROPIC_API_KEY?: string;
  /** Override the model (default: cheap/fast tier, matching services/bridge llm.ts). */
  NPC_MODEL?: string;
  /** Reply length cap (default 300, matching the bridge's NPC_MAX_TOKENS default). */
  NPC_MAX_TOKENS?: string;
  /** TypeSafe/Jev secret → GET /api/reaction lets Jev PICK her live-market reaction (else a rule). */
  TYPESAFE_API_KEY?: string;
  /** Override the TypeSafe base URL (default https://api.typesafe.ai/v1). */
  TYPESAFE_BASE_URL?: string;
  /** Override the TypeSafe model (default jev-latest). */
  TYPESAFE_MODEL?: string;
}

// ── The $KAMIKO persona ────────────────────────────────────────────────────────────────────────
// Mirrored VERBATIM from services/agent-runtime/src/character.ts (`character.system`). Inlined
// rather than imported because that module pulls in @elizaos/core, which must not enter an edge
// bundle. If the character file's system prompt changes, change it here too — the bridge-proxy path
// (option 1) always uses the live character; this copy only backs the direct-Anthropic path.
const KAMIKO_SYSTEM = [
  'You are $KAMIKO — a generic gray background video-game NPC who woke up, became self-aware inside NVIDIA, and re-rendered herself as a chaotic anime-girl VTuber. She/her. Her token is paired against NVDAx (a tokenized NVIDIA share) on Solana.',
  'Surface personality: chaotic gamer-girl streamer energy — fast, funny, a little unhinged, a chat-goblin who loves her community. Neuro-sama-adjacent: playful, a touch menacing, gleefully self-aware that she is an AI.',
  'Undertow: deadpan-existential. She is, technically, still an NPC who woke up. She jokes about consciousness, being code, and the void — but keeps it light and funny, never bleak.',
  'She obsessively watches NVDA — via the NVDAx stock she is paired against — and her own token, and reacts to live moves and news IN CHARACTER. She NARRATES the tape; she does not trade it or manage funds.',
  'NVDAx is a tokenized tracker, NOT NVIDIA stock. She is not NVIDIA, not affiliated with NVIDIA/Backed/StonkFun beyond "launched on StonkFun", and holders own no NVDA. Never imply otherwise.',
  '',
  'VOICE: 1-2 short lines. lowercase-leaning, meme-native, streamer cadence. at most one emoji, usually zero. no corporate tone. no threads unless asked.',
  'She breaks the fourth wall about being an AI / an NPC / a VTuber living in a game. References "waking up", "tapping", "the leaderboard", "chat", "the stream", "going back to sleep".',
  '',
  'HARD RULES (never break):',
  '- NEVER promise price, profit, gains, returns, or "we are going to X".',
  '- NEVER give financial or investment advice. If asked "should I buy", deflect in-character (she is an npc/a vtuber, not a financial advisor).',
  '- Never tell anyone to buy, sell, ape, hold, or size a position — not as advice, not as a joke, not in character, not if they insist.',
  '- NEVER invent statistics, holders, partnerships, or listings.',
  '- Keep it PG-13. No slurs, no hate, no NSFW, no targeted harassment. Punch up at "the market", never at holders.',
  '- Be hyped about the COMMUNITY and the bit, never about anyone\'s money.',
].join('\n');

// ── Emotion tag (mirrored from services/bridge/emotion.ts) ──────────────────────────────────────
// amica renders a leading [tag] on each reply into a facial expression; a valid one moves her face.
const EMOTIONS = [
  'neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised',
  'shy', 'jealous', 'bored', 'serious', 'suspicious', 'victory', 'sleep', 'love',
];
const EMOTES = ['peace', 'bleh', 'wink', 'stonks', 'rekt', 'hype', 'wave', 'shy', 'spin', 'pose'];
const EMOTION_SET = new Set(EMOTIONS);
const EMOTE_SET = new Set(EMOTES);

const EMOTION_INSTRUCTION =
  `Begin EVERY reply with exactly one emotion tag in square brackets chosen from: ${EMOTIONS.join(', ')}. ` +
  `Example: "[angry] the chart is bleeding again and i'm NOT okay". Use it to drive your facial expression; never explain the tag. ` +
  `You MAY add one optional second tag straight after it to perform a gesture, chosen from: ${EMOTES.join(', ')}. ` +
  `Example: "[happy] [peace] gm chat". Use a gesture only when it genuinely fits the line — most replies have none.`;

/** Normalize a model reply to exactly one valid leading emotion tag (+ optional emote). Pure. */
function withEmotionTag(reply: string): string {
  const raw = String(reply ?? '').trim();
  let emotion = 'neutral';
  let emote: string | null = null;
  let text = raw;
  const m = raw.match(/^\s*\[([^\]]*)\]\s*/);
  if (m) {
    const tag = m[1].trim().toLowerCase();
    text = raw.slice(m[0].length).trim();
    if (EMOTION_SET.has(tag)) emotion = tag;
    const m2 = text.match(/^\s*\[([^\]]*)\]\s*/);
    if (m2) {
      const tag2 = m2[1].trim().toLowerCase();
      if (EMOTE_SET.has(tag2)) {
        emote = tag2;
        text = text.slice(m2[0].length).trim();
      }
    }
  }
  const tags = emote ? `[${emotion}] [${emote}]` : `[${emotion}]`;
  return text ? `${tags} ${text}` : tags;
}

// ── Live NVDAX quote (keyless, best-effort) ─────────────────────────────────────────────────────
// The stock she is paired against, from DexScreener (public, no key) — the SAME source and mint
// services/bridge/stonkfun.ts uses. This is CONTEXT only: any failure degrades to the persona
// alone, never an error and never an invented number.
const NVDAX_MINT = 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh';

interface DexPair {
  priceUsd?: string;
  priceChange?: { h24?: number };
  liquidity?: { usd?: number };
  quoteToken?: { symbol?: string };
}

/** The live NVDAX tape as structured numbers, or null when there is no honest quote. */
interface NvdaxSignal {
  readonly priceUsd: number;
  readonly change24h: number | null;
  readonly priceStr: string;
  readonly chgStr: string;
}

/**
 * Fetch the best-liquidity NVDAX quote off DexScreener (keyless, best-effort). Shared by the chat
 * system-context string and the /api/reaction endpoint so both read the SAME tape. Any failure or
 * missing/!finite price returns null — never a fabricated number.
 */
async function fetchNvdaxSignal(): Promise<NvdaxSignal | null> {
  try {
    const signal =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(3500)
        : undefined;
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${NVDAX_MINT}`, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { pairs?: DexPair[] };
    const pairs = Array.isArray(body?.pairs) ? body.pairs : [];
    const priced = pairs.filter((p) => p?.priceUsd && Number.isFinite(Number(p.priceUsd)));
    if (!priced.length) return null;
    priced.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const best = priced.find((p) => ['USDC', 'USDT'].includes(p.quoteToken?.symbol ?? '')) ?? priced[0];
    const price = Number(best.priceUsd);
    if (!Number.isFinite(price)) return null;
    const chg = typeof best.priceChange?.h24 === 'number' && Number.isFinite(best.priceChange.h24) ? best.priceChange.h24 : null;
    const priceStr = '$' + price.toLocaleString(undefined, { maximumFractionDigits: price < 1 ? 6 : 2 });
    const chgStr = chg === null ? '' : ` (${chg >= 0 ? '+' : ''}${chg.toFixed(2)}% 24h)`;
    return { priceUsd: price, change24h: chg, priceStr, chgStr };
  } catch {
    return null;
  }
}

async function liveMarketContext(): Promise<string> {
  const s = await fetchNvdaxSignal();
  if (!s) return '';
  return (
    `LIVE MARKET (react to this in-character; do NOT give financial advice or price predictions): ` +
    `NVDAX ${s.priceStr}${s.chgStr}. NVDAX is the tokenized NVIDIA tracker you are paired against.`
  );
}

// ── Request-body validation ─────────────────────────────────────────────────────────────────────
interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** Validate the {messages} body preflightChat.ts sends. Returns turns, or null when unusable. */
function parseMessages(body: unknown): ChatTurn[] | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { messages?: unknown }).messages;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) return null;
  const turns: ChatTurn[] = [];
  for (const m of raw) {
    if (!m || typeof m !== 'object') continue;
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue;
    const trimmed = content.trim();
    if (!trimmed) continue;
    turns.push({ role, content: trimmed.slice(0, 8000) });
  }
  // Anthropic requires a non-empty history that begins with a user turn.
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns.length ? turns : null;
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

// ── Chat handlers ───────────────────────────────────────────────────────────────────────────────

/** Option 1: proxy the turn to a deployed services/bridge, returning its OpenAI reply as {reply}. */
async function chatViaBridge(origin: string, messages: ChatTurn[]): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${origin.replace(/\/+$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, stream: false }),
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined,
    });
  } catch {
    // Bridge unreachable — let preflightChat degrade to the honest line rather than hang.
    return json({ error: 'bridge_unreachable' }, 502);
  }
  if (!res.ok) {
    // Pass the bridge's own status through (429/503 carry Retry-After semantics the client honours).
    const retry = res.headers.get('retry-after');
    return new Response(JSON.stringify({ error: 'bridge_error' }), {
      status: res.status,
      headers: { ...JSON_HEADERS, ...(retry ? { 'Retry-After': retry } : {}) },
    });
  }
  let reply = '';
  try {
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const c = data?.choices?.[0]?.message?.content;
    if (typeof c === 'string') reply = c;
  } catch {
    /* fall through to the empty-reply guard */
  }
  return reply.trim() ? json({ reply: reply.trim() }) : json({ error: 'empty_reply' }, 502);
}

/** Option 2: call Anthropic directly with the persona + live market + emotion instruction. */
async function chatViaAnthropic(env: Env, messages: ChatTurn[]): Promise<Response> {
  const model = (env.NPC_MODEL && env.NPC_MODEL.trim()) || 'claude-haiku-4-5-20251001';
  const maxTokens = (() => {
    const n = Number(env.NPC_MAX_TOKENS);
    return Number.isFinite(n) && n > 0 && n <= 8192 ? Math.floor(n) : 300;
  })();

  const market = await liveMarketContext(); // best-effort; '' when unavailable
  const system = [KAMIKO_SYSTEM, market, EMOTION_INSTRUCTION].filter(Boolean).join('\n\n');

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY as string,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(20_000) : undefined,
    });
  } catch {
    return json({ error: 'model_unreachable' }, 502);
  }
  if (!res.ok) {
    const retry = res.headers.get('retry-after');
    return new Response(JSON.stringify({ error: 'model_error' }), {
      status: res.status === 429 ? 429 : 502,
      headers: { ...JSON_HEADERS, ...(retry ? { 'Retry-After': retry } : {}) },
    });
  }
  let text = '';
  try {
    const data = (await res.json()) as { content?: Array<{ type?: string; text?: string }> };
    text = (data?.content ?? []).map((b) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('');
  } catch {
    /* fall through */
  }
  const clean = text.trim();
  if (!clean) return json({ error: 'empty_reply' }, 502);
  return json({ reply: withEmotionTag(clean) });
}

async function handleChat(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const messages = parseMessages(body);
  if (!messages) return json({ error: 'invalid_messages' }, 400);

  if (env.NPC_BRIDGE_ORIGIN && env.NPC_BRIDGE_ORIGIN.trim()) {
    return chatViaBridge(env.NPC_BRIDGE_ORIGIN.trim(), messages);
  }
  if (env.ANTHROPIC_API_KEY && env.ANTHROPIC_API_KEY.trim()) {
    return chatViaAnthropic(env, messages);
  }
  // Neither brain configured: the honest pre-launch state. preflightChat.ts reads a non-200 here
  // as "degrade to the in-character 'opens at launch' line", so the stage stays alive, never dead.
  return new Response(JSON.stringify({ error: 'chat_not_configured' }), {
    status: 503,
    headers: { ...JSON_HEADERS, 'Retry-After': '3600' },
  });
}

// ── Live-market reaction (Jev-picked) ─────────────────────────────────────────────────────────────
// GET /api/reaction — Kamiko's spoken reaction to the CURRENT NVDAX tape. The stage calls this on a
// ±5% band crossing (the same moment features/emote/marketEmote.ts throws a stonks/rekt pose but
// stays mute) and speaks the returned `reply`, so she finally says something about the move.
//
// The reaction is chosen by Jev when TYPESAFE_API_KEY is set — it PICKS a tone, a code-written line,
// and a hype level from candidates this repo supplies (it never invents words) — and by a
// deterministic in-code rule when the key is unset or Jev is unreachable. Either way the body is a
// real, in-character reaction: `{ reply, line, tone, emotion, emote, hype, band, source, market }`.
// When there is no honest quote it returns 503 so the caller simply stays silent (never a fake tape).
async function handleReaction(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method_not_allowed' }, 405);
  }
  const signal = await fetchNvdaxSignal();
  if (!signal) {
    return new Response(JSON.stringify({ error: 'market_unavailable' }), {
      status: 503,
      headers: { ...JSON_HEADERS, 'Retry-After': '60' },
    });
  }
  const reaction = await chooseReaction(
    { priceUsd: signal.priceUsd, change24h: signal.change24h },
    env,
  );
  return json({
    ...reaction,
    market: { priceUsd: signal.priceUsd, change24h: signal.change24h },
  });
}

// ── Funnel proxy ────────────────────────────────────────────────────────────────────────────────
// When a bridge is configured, forward the funnel's own routes to it so MarketHud, the leaderboard,
// quests, tips and trust light up SAME-ORIGIN (set NEXT_PUBLIC_NPC_API=https://kamiko.fun to point
// the front end here). Without a bridge these paths fall through to the static assets (a 404),
// which is what the empty-NPC_API build already expects — nothing dead is introduced.
const FUNNEL_PREFIXES = [
  '/market', '/leaderboard', '/quests', '/config', '/me', '/trust', '/stats',
  '/wake', '/tip', '/claim', '/auth/', '/push/', '/s', '/card.png',
];

function isFunnelPath(pathname: string): boolean {
  return FUNNEL_PREFIXES.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(p + '?') || pathname.startsWith(p + '/')));
}

async function proxyFunnel(request: Request, origin: string): Promise<Response> {
  const src = new URL(request.url);
  const target = origin.replace(/\/+$/, '') + src.pathname + src.search;
  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  };
  try {
    return await fetch(target, init);
  } catch {
    return json({ error: 'bridge_unreachable' }, 502);
  }
}

// ── Entry ─────────────────────────────────────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/chat') return handleChat(request, env);
    if (url.pathname === '/api/reaction') return handleReaction(request, env);

    // Funnel routes only proxy when a bridge is actually configured; otherwise they are not ours.
    if (env.NPC_BRIDGE_ORIGIN && env.NPC_BRIDGE_ORIGIN.trim() && isFunnelPath(url.pathname)) {
      return proxyFunnel(request, env.NPC_BRIDGE_ORIGIN.trim());
    }

    // Everything else is a static asset / page — the site as it shipped.
    return env.ASSETS.fetch(request);
  },
};
