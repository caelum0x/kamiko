/**
 * cta.ts — what the funnel is allowed to SAY about the contract.
 *
 * One source for every $KAMIKO surface in amica (the game, the holder dashboard, the trust page). The
 * rule it exists to enforce: the buy/chart CTA is written by the on-chain verifier or not at all.
 * GET /trust is the only thing that knows the real mint, and the states below are kept apart on
 * purpose, because collapsing any two of them produces a false statement on a page people buy from.
 *
 *   'live'         — verified mainnet mint, verdict pass. Show the CTA.
 *   'caution'      — same, but verdict warn. Show the CTA with the warning attached.
 *   'unsafe'       — the verifier FAILED this token. No CTA, say so, point at the trust page.
 *   'not-launched' — the verifier itself says there is no mint yet. The ONLY state in which this
 *                    page may claim a contract does not exist.
 *   'unverified'   — we could not reach the verifier, could not parse it, or it published no
 *                    verdict. We say "unverified", never "there is no contract": post-launch, one
 *                    API outage would otherwise have the site disowning its own real mint.
 *
 * Ported from @kamiko/web-kit (packages/web-kit/src/npc.ts), which is the audited source these rules
 * were written in; the shapes mirror packages/onchain/report.ts.
 */
import { isBase58Address } from './config.ts';

export type Verdict = 'pass' | 'warn' | 'fail' | 'unknown';
export type CtaStateName = 'live' | 'caution' | 'unsafe' | 'not-launched' | 'unverified';

export interface CtaLinks {
  mint: string;
  buy: string;
  chart: string;
  short: string;
  verdict: Verdict;
  grade: string;
  caution: boolean;
}

export interface CtaState {
  state: CtaStateName;
  cta: CtaLinks | null;
  title: string;
  detail: string;
}

/** PURE. Same shape test as a Solana address, named for the thing the pages ask about most. */
export const isMintAddress = (s: unknown): s is string => isBase58Address(s);

/**
 * PURE. Does this report's `network` mean Solana mainnet?
 *
 * Mirrors services/game-api/trust-loader.ts `networkToCluster`, which accepts BOTH 'mainnet' and
 * 'mainnet-beta'. A front end that only knew the first spelling silently withheld the CTA — and kept
 * claiming "not launched" — for a live token whose operator wrote the other one. Unknown values are
 * not mainnet: fail closed.
 */
export function isMainnetNetwork(network: unknown): boolean {
  if (network == null) return true; // no network stated ⇒ the report's own default is mainnet
  if (typeof network !== 'string') return false;
  const n = network.trim().toLowerCase();
  return n === '' || n === 'mainnet' || n === 'mainnet-beta';
}

/** PURE. The verifier's own headline judgement, normalised. */
export function verdictOf(report: any): Verdict {
  const v = report && report.verdict;
  return v === 'pass' || v === 'warn' || v === 'fail' ? v : 'unknown';
}

/** PURE. The published grade, or 'unrated'. Never computed here — the trust page has the same rule. */
export function gradeOf(report: any): string {
  const g = report && report.score && report.score.grade;
  return typeof g === 'string' && g ? g : 'unrated';
}

export const dexscreenerUrl = (mint: string): string => 'https://dexscreener.com/solana/' + mint;

/**
 * PURE. StonkFun token page — the actual launch venue for this run: a Raydium LaunchLab pad where
 * $KAMIKO is quoted against NVDAX (the "NVIDIA" xStock), not SOL. See
 * RESEARCH/02-stonkfun-and-launchlab.md. That doc pins the host + API paths but not the public
 * token-page segment, so this uses the conventional `/token/{mint}` shape. [VERIFY AT LAUNCH]
 */
export const stonkfunUrl = (mint: string): string => 'https://www.stonkfun.xyz/token/' + mint;

/** PURE. The launch venue's own page, when we know the venue. null when we do not. */
export function venueTokenUrl(venue: string, mint: string): string | null {
  if (venue === 'stonkfun') return stonkfunUrl(mint);
  if (venue === 'pumpfun') return 'https://pump.fun/coin/' + mint;
  if (venue === 'letsbonk') return 'https://letsbonk.fun/token/' + mint;
  return null;
}

/**
 * PURE. Find the venue page for THIS mint among the report's own links.
 * The trust report publishes links, not a venue id, so we match the link back to the shapes
 * venueTokenUrl builds — a link for another mint, or any other host, is ignored.
 */
export function venueLinkFrom(links: unknown, mint: unknown): string | null {
  if (!Array.isArray(links) || !isMintAddress(mint)) return null;
  const wanted = [venueTokenUrl('stonkfun', mint), venueTokenUrl('pumpfun', mint), venueTokenUrl('letsbonk', mint)];
  for (const link of links) {
    const u = link && (link as { url?: unknown }).url;
    if (typeof u !== 'string') continue;
    const clean = u.replace(/\/+$/, '');
    if (wanted.indexOf(clean) !== -1) return clean;
  }
  return null;
}

/**
 * PURE. The buy/chart CTAs, derived from GET /trust.
 *
 * Returns null — meaning "render no CTA" — unless ALL of these hold: it is a report the verifier
 * produced (`schema`, `ok:true`), it names a mint of the right shape on mainnet, and the verifier's
 * own `verdict` is pass or warn. `fail` and `unknown` get nothing: a green BUY button over a token
 * our own verifier failed (or never graded) is the single worst thing this page could render.
 */
export function ctaLinks(report: any): CtaLinks | null {
  if (!report || typeof report !== 'object') return null;
  if (report.schema !== 'npc.trust-report' || report.ok !== true) return null;
  const mint = report.mint;
  if (!isMintAddress(mint)) return null;
  // DexScreener and the launch venues are mainnet surfaces; a devnet mint has no page there.
  if (!isMainnetNetwork(report.network)) return null;
  const verdict = verdictOf(report);
  if (verdict !== 'pass' && verdict !== 'warn') return null;
  const chart = dexscreenerUrl(mint);
  return {
    mint,
    chart,
    buy: venueLinkFrom(report.links, mint) || chart,
    short: mint.slice(0, 4) + '…' + mint.slice(-4),
    verdict,
    grade: gradeOf(report),
    caution: verdict === 'warn',
  };
}

/** PURE. What the funnel should SAY about the contract, given (or missing) a trust report. */
export function ctaState(report: any): CtaState {
  const unverified = (detail: string): CtaState => ({ state: 'unverified', cta: null, title: 'contract unverified.', detail });

  if (!report || typeof report !== 'object' || report.schema !== 'npc.trust-report') {
    return unverified('this page could not get an answer from the trust verifier, so it cannot confirm a contract either way. check the trust page — and trust no address you were sent elsewhere.');
  }
  if (report.ok !== true) {
    const u = report.unavailable && typeof report.unavailable === 'object' ? report.unavailable : null;
    const detail = u && typeof u.detail === 'string' && u.detail ? u.detail : '';
    if (u && u.reason === 'not-launched') {
      return {
        state: 'not-launched',
        cta: null,
        title: 'not launched.',
        detail: detail || 'there is no contract yet — anything calling itself $KAMIKO right now is not us. she launches on stonkfun, paired against nvdax (a tokenized nvidia tracker, not nvidia stock).',
      };
    }
    return unverified(detail || 'the verifier could not produce a report right now.');
  }
  if (!isMintAddress(report.mint)) return unverified('the verifier answered, but published no contract address.');
  if (!isMainnetNetwork(report.network)) {
    return unverified('the published report is for ' + String(report.network) + ', not mainnet — there is no public chart or venue page for it.');
  }
  if (verdictOf(report) === 'fail') {
    return {
      state: 'unsafe',
      cta: null,
      title: 'the verifier failed this token.',
      detail: 'we are not publishing a buy link for a report our own verifier graded ' + gradeOf(report) + '. read the trust page before you touch it.',
    };
  }
  const cta = ctaLinks(report);
  if (!cta) return unverified('the verifier published a contract but no verdict for it, so this page will not vouch for it.');
  if (cta.caution) {
    return {
      state: 'caution',
      cta,
      title: 'verified with warnings.',
      detail: 'the verifier graded this ' + cta.grade + ' with open warnings. the links below are the real $KAMIKO/nvdax contract on stonkfun — read the trust page before you buy.',
    };
  }
  return { state: 'live', cta, title: 'verified.', detail: 'graded ' + cta.grade + ' by our on-chain verifier. $KAMIKO/nvdax on stonkfun.' };
}

/** The one-line label the header shows next to the contract, for any state. */
export function caLabel(st: CtaState | null): string {
  if (st?.cta) return 'CA: ' + st.cta.short + ' — tap to copy';
  if (st?.state === 'not-launched') return 'CA: not launched yet';
  return 'CA: unverified';
}
