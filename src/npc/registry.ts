/**
 * registry.ts — PURE parsers and formatters for the kamiko.fun registry surfaces
 * (services/registry: /agents, /agents/:ticker, /agents/:ticker/trust, /agents/:ticker/mentions,
 * /listings, /graph). The /agents pages render ONLY what comes out of these functions.
 *
 * The rules are the ones trust.tsx already lives by, applied to a directory:
 *
 *   - EVERY PAYLOAD IS UNTRUSTED. The registry is our own service, but the URL is operator
 *     configuration and the answer crosses the network — an unrecognised shape parses to `null`
 *     (the page says "unrecognised answer"), never to a half-filled card.
 *   - A MALFORMED ROW IS DROPPED AND COUNTED, never patched up. `dropped` is surfaced so an
 *     operator can see the registry and the front end disagree about a schema.
 *   - BADGES FAIL CLOSED. `pledgeVerified` must be `=== true`; a grade we do not recognise tones
 *     grey; a mint with no on-chain proof is labelled a creator claim, exactly as the registry
 *     itself labels it (`mintSource: 'unverified-legacy'`).
 *   - IDS THAT BECOME URLS ARE SHAPE-CHECKED HERE. A ticker is interpolated into
 *     `${REGISTRY}/agents/<ticker>` and a listing id into `/listings/<id>/artifact`; the shapes
 *     are the registry's own (`/^[A-Za-z0-9]{2,10}$/`, 64 hex chars), restated at the site that
 *     builds the link rather than trusted from the wire.
 *
 * Everything here is pure so the whole contract is testable without a browser or a registry.
 */

/** The registry's own ticker shape (services/registry/registry.ts isValidTicker). */
export function isRegistryTicker(t: unknown): t is string {
  return typeof t === 'string' && /^[A-Za-z0-9]{2,10}$/.test(t);
}

/** The registry's own listing id shape (services/registry/listings.ts LISTING_ID_RE). */
export function isListingId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}

/** Bounded plain string out of an untrusted field, or the fallback. Never throws. */
function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) + '…' : t;
}

const posInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;

/* ------------------------------------------------------------------ *
 * Badges — the tone is derived from facts, never from hope.
 * ------------------------------------------------------------------ */

export type BadgeTone = 'good' | 'caution' | 'bad' | 'unknown';

/** Grade → tone, the same banding trust.tsx uses. An unrecognised grade stays grey. */
export function gradeTone(grade: string): BadgeTone {
  if (grade === 'A' || grade === 'B') return 'good';
  if (grade === 'C' || grade === 'D') return 'caution';
  if (grade === 'F') return 'bad';
  return 'unknown';
}

export interface MintBadge {
  label: string;
  tone: BadgeTone;
}

/**
 * How to say what a row's mint field means. The registry states provenance
 * (`mintVerified`/`mintSource`) and this maps it to words without upgrading a claim to a fact:
 * a mint the registry did not verify on-chain is presented as the creator's claim it is.
 */
export function mintBadge(a: { mint: string | null; mintVerified: boolean }): MintBadge {
  if (!a.mint) return { label: 'pre-launch — no token', tone: 'unknown' };
  if (a.mintVerified) return { label: 'mint verified on-chain', tone: 'good' };
  return { label: 'mint UNVERIFIED — creator claim', tone: 'caution' };
}

/* ------------------------------------------------------------------ *
 * GET /agents — the directory.
 * ------------------------------------------------------------------ */

export interface AgentSummary {
  ticker: string;
  name: string;
  tagline: string | null;
  status: 'launched' | 'registered';
  /** The registry's display grade — 'unrated' pre-launch. Toned by `gradeTone`. */
  trustGrade: string;
  /** Where that grade came from. 'unknown' when the registry sent something unrecognised. */
  trustGradeSource: 'self-reported' | 'pre-launch' | 'unknown';
  pledgeVerified: boolean;
  mint: string | null;
  mintVerified: boolean;
  mintSource: string | null;
  created: number | null;
}

export interface ParsedDirectory {
  agents: AgentSummary[];
  /** Rows the registry sent that this build refused to render. Non-zero means schema drift. */
  dropped: number;
}

function parseAgentRow(row: unknown): AgentSummary | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (!isRegistryTicker(r.ticker)) return null;
  const name = str(r.name, 80);
  if (!name) return null;
  const mint = str(r.mint, 64);
  const source = r.trustGradeSource === 'self-reported' || r.trustGradeSource === 'pre-launch'
    ? r.trustGradeSource
    : 'unknown';
  return {
    ticker: r.ticker,
    name,
    tagline: str(r.tagline, 160),
    status: mint ? 'launched' : 'registered',
    trustGrade: str(r.trustGrade, 16) ?? 'unrated',
    trustGradeSource: source,
    pledgeVerified: r.pledgeVerified === true,
    mint,
    mintVerified: r.mintVerified === true,
    mintSource: str(r.mintSource, 64),
    created: posInt(r.created),
  };
}

export function parseAgentsDirectory(body: unknown): ParsedDirectory | null {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { agents?: unknown }).agents)) return null;
  const raw = (body as { agents: unknown[] }).agents;
  const agents: AgentSummary[] = [];
  let dropped = 0;
  for (const row of raw) {
    const a = parseAgentRow(row);
    if (a) agents.push(a);
    else dropped += 1;
  }
  return { agents, dropped };
}

/* ------------------------------------------------------------------ *
 * GET /agents/:ticker — one agent, with what its character says about itself.
 * ------------------------------------------------------------------ */

export interface AgentDetail extends AgentSummary {
  pledgeSigner: string | null;
  /** A displayable slice of the registered character — bio/system text, never executed. */
  about: string | null;
}

export function parseAgentDetail(body: unknown): AgentDetail | null {
  const base = parseAgentRow(body);
  if (!base) return null;
  const r = body as Record<string, unknown>;
  // The detail route does not send trustGrade — its grade arrives via the /trust view. Keep the
  // summary's fail-closed defaults and add the detail-only fields.
  let about: string | null = null;
  const ch = r.character;
  if (ch && typeof ch === 'object') {
    const c = ch as Record<string, unknown>;
    about =
      str(c.bio, 500) ??
      str(Array.isArray(c.bio) ? (c.bio as unknown[]).filter((x) => typeof x === 'string').join(' ') : null, 500) ??
      str(c.system, 500) ??
      str(Array.isArray(c.system) ? (c.system as unknown[]).filter((x) => typeof x === 'string').join(' ') : null, 500);
  }
  return { ...base, pledgeSigner: str(r.pledgeSigner, 64), about };
}

/* ------------------------------------------------------------------ *
 * GET /agents/:ticker/trust — the registry's honest trust view.
 * ------------------------------------------------------------------ */

export type AgentTrustView =
  | {
      kind: 'self-reported';
      grade: string;
      score: number | null;
      confidence: number | null;
      checkedAt: number | null;
      summary: string | null;
      note: string | null;
      reportedBy: string | null;
    }
  | { kind: 'pre-launch'; grade: string; score: number | null; confidence: number | null; summary: string | null };

/**
 * `null` means "we do not understand what the registry said", which the page renders as
 * UNVERIFIED — never as a grade. A self-reported view keeps the registry's own disclaimer text.
 */
export function parseAgentTrust(body: unknown): AgentTrustView | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as Record<string, unknown>;
  const grade = str(r.grade, 16);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (r.source === 'self-reported') {
    if (!grade) return null;
    return {
      kind: 'self-reported',
      grade,
      score: num(r.score),
      confidence: num(r.confidence),
      checkedAt: posInt(r.checkedAt),
      summary: str(r.summary, 400),
      note: str(r.note, 400),
      reportedBy: str(r.reportedBy, 64),
    };
  }
  if (r.source === 'pre-launch') {
    if (!grade) return null;
    return { kind: 'pre-launch', grade, score: num(r.score), confidence: num(r.confidence), summary: str(r.summary, 400) };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Mentions — signed statements by one agent about another. Data, not ranking.
 * ------------------------------------------------------------------ */

export interface Mention {
  from: string;
  to: string;
  /** Stranger text. Rendered as text only (React escapes it); bounded here as well. */
  note: string | null;
  created: number | null;
}

export interface ParsedMentions {
  mentions: Mention[];
  mentionedBy: Mention[];
  dropped: number;
}

function parseEdge(row: unknown): Mention | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (!isRegistryTicker(r.from) || !isRegistryTicker(r.to)) return null;
  return { from: r.from, to: r.to, note: str(r.note, 280), created: posInt(r.created) };
}

function parseEdgeList(raw: unknown): { edges: Mention[]; dropped: number } {
  if (!Array.isArray(raw)) return { edges: [], dropped: 0 };
  const edges: Mention[] = [];
  let dropped = 0;
  for (const row of raw) {
    const e = parseEdge(row);
    if (e) edges.push(e);
    else dropped += 1;
  }
  return { edges, dropped };
}

/** GET /agents/:ticker/mentions → both directions, or null when the shape is unrecognised. */
export function parseMentions(body: unknown): ParsedMentions | null {
  if (!body || typeof body !== 'object') return null;
  const r = body as Record<string, unknown>;
  if (!Array.isArray(r.mentions) && !Array.isArray(r.mentionedBy)) return null;
  const out = parseEdgeList(r.mentions);
  const inn = parseEdgeList(r.mentionedBy);
  return { mentions: out.edges, mentionedBy: inn.edges, dropped: out.dropped + inn.dropped };
}

/** GET /graph → the whole directory's recent edges, or null when unrecognised. */
export function parseGraph(body: unknown): { edges: Mention[]; dropped: number } | null {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { edges?: unknown }).edges)) return null;
  return parseEdgeList((body as { edges: unknown[] }).edges);
}

/* ------------------------------------------------------------------ *
 * GET /listings — the marketplace directory (recorded prices, nothing settled).
 * ------------------------------------------------------------------ */

export const LISTING_KINDS = ['character', 'voice', 'plugin'] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

export interface ListingSummary {
  id: string;
  kind: ListingKind;
  title: string;
  summary: string | null;
  publisher: string;
  priceLabel: string;
  license: string | null;
  artifactSha256: string | null;
  artifactBytes: number | null;
  created: number | null;
}

/**
 * Minor units → words. Lamports for SOL (1e9), micro-USDC for USDC (1e6), `0` → 'free'.
 * An unrecognised currency or a non-integer amount is 'price unknown' — a marketplace must
 * never invent a number.
 */
export function formatListingPrice(price: unknown): string {
  if (!price || typeof price !== 'object') return 'price unknown';
  const p = price as { amount?: unknown; currency?: unknown };
  const amount = typeof p.amount === 'number' && Number.isInteger(p.amount) && p.amount >= 0 ? p.amount : null;
  if (amount === null) return 'price unknown';
  if (amount === 0) return 'free';
  if (p.currency === 'SOL') return `${trimZeros((amount / 1e9).toFixed(9))} SOL`;
  if (p.currency === 'USDC') return `${trimZeros((amount / 1e6).toFixed(6))} USDC`;
  return 'price unknown';
}

const trimZeros = (s: string): string => s.replace(/\.?0+$/, '');

function parseListingRow(row: unknown): ListingSummary | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (!isListingId(r.id)) return null;
  if (typeof r.kind !== 'string' || !LISTING_KINDS.includes(r.kind as ListingKind)) return null;
  const title = str(r.title, 120);
  const publisher = str(r.publisher, 64);
  if (!title || !publisher) return null;
  return {
    id: r.id,
    kind: r.kind as ListingKind,
    title,
    summary: str(r.summary, 300),
    publisher,
    priceLabel: formatListingPrice(r.price),
    license: str(r.license, 40),
    artifactSha256: str(r.artifactSha256, 64),
    artifactBytes: posInt(r.artifactBytes),
    created: posInt(r.created),
  };
}

export function parseListings(body: unknown): { listings: ListingSummary[]; dropped: number } | null {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { listings?: unknown }).listings)) return null;
  const raw = (body as { listings: unknown[] }).listings;
  const listings: ListingSummary[] = [];
  let dropped = 0;
  for (const row of raw) {
    const l = parseListingRow(row);
    if (l) listings.push(l);
    else dropped += 1;
  }
  return { listings, dropped };
}

/* ------------------------------------------------------------------ *
 * Link-out builders — the only place a registry URL is assembled.
 * ------------------------------------------------------------------ */

/**
 * `${REGISTRY}/agents/<ticker>` etc, or null when either half fails its shape check. A null link
 * renders as no link — a page must never emit an anchor whose path a payload chose freely.
 */
export function agentJsonUrl(registry: string, ticker: string): string | null {
  if (!registry || !isRegistryTicker(ticker)) return null;
  return `${registry}/agents/${ticker}`;
}

export function listingArtifactUrl(registry: string, id: string): string | null {
  if (!registry || !isListingId(id)) return null;
  return `${registry}/listings/${id}/artifact`;
}

/** Short middle-elided form of a base58 key / hash for a directory row. */
export function shortKey(k: string, keep = 4): string {
  return k.length <= keep * 2 + 1 ? k : `${k.slice(0, keep)}…${k.slice(-keep)}`;
}
