/**
 * registry.spec.ts — the pure contract the /agents pages render through.
 *
 * Every test here would fail without the behaviour it names: the parsers are the ONLY path from a
 * registry payload to the screen, so "an unrecognised shape parses to null" and "a malformed row is
 * dropped and counted" are the page's entire safety story against a wrong, stale or hostile answer.
 */
import { describe, expect, jest, test } from '@jest/globals';

import {
  agentJsonUrl, formatListingPrice, gradeTone, isListingId, isRegistryTicker, listingArtifactUrl,
  mintBadge, parseAgentDetail, parseAgentTrust, parseAgentsDirectory, parseGraph, parseListings,
  parseMentions, shortKey,
} from '../registry.ts';

const LISTING_ID = 'a'.repeat(64);

/** A directory row exactly as services/registry's GET /agents emits it. */
const AGENT_ROW = {
  ticker: 'NPC', name: 'Kamiko', tagline: 'the npc that woke up', mint: null, created: 1725500000000,
  status: 'registered', guardrails: 'enforced', trustGrade: 'unrated', trustGradeSource: 'pre-launch',
  pledgeVerified: true, mintVerified: false, mintSource: null,
};

describe('shape gates (the strings that become URL paths)', () => {
  test('accepts the registry-native shapes', () => {
    expect(isRegistryTicker('NPC')).toBe(true);
    expect(isListingId(LISTING_ID)).toBe(true);
  });
  test('refuses path-breaking or foreign shapes', () => {
    for (const bad of ['', 'a', '../etc', 'NPC/mint', 'x'.repeat(11), 42, null]) {
      expect(isRegistryTicker(bad)).toBe(false);
    }
    expect(isListingId('A'.repeat(64))).toBe(false); // upper hex is not the registry's id shape
    expect(isListingId('a'.repeat(63))).toBe(false);
  });
});

describe('parseAgentsDirectory', () => {
  test('parses the registry payload and fails badges closed', () => {
    const out = parseAgentsDirectory({ agents: [AGENT_ROW] });
    expect(out).not.toBeNull();
    expect(out!.agents).toHaveLength(1);
    const a = out!.agents[0];
    expect(a.ticker).toBe('NPC');
    expect(a.status).toBe('registered');
    expect(a.pledgeVerified).toBe(true);
    expect(a.trustGradeSource).toBe('pre-launch');
  });

  test('an unrecognised envelope is null, never a partial directory', () => {
    expect(parseAgentsDirectory(null)).toBeNull();
    expect(parseAgentsDirectory({ error: 'rate limited' })).toBeNull();
    expect(parseAgentsDirectory('agents')).toBeNull();
  });

  test('a malformed row is dropped AND counted, not patched up', () => {
    const out = parseAgentsDirectory({ agents: [AGENT_ROW, { ticker: '../x', name: 'evil' }, { name: 'no ticker' }] });
    expect(out!.agents).toHaveLength(1);
    expect(out!.dropped).toBe(2);
  });

  test('badge fields fail closed on truthy-but-not-true values', () => {
    const out = parseAgentsDirectory({
      agents: [{ ...AGENT_ROW, pledgeVerified: 1, mintVerified: 'yes', trustGradeSource: 'on-chain-totally' }],
    });
    const a = out!.agents[0];
    expect(a.pledgeVerified).toBe(false); // 1 is not a verified pledge
    expect(a.mintVerified).toBe(false); // 'yes' is not on-chain proof
    expect(a.trustGradeSource).toBe('unknown'); // an unrecognised source is never promoted
  });

  test('status derives from the mint, and a launched row keeps its mint string', () => {
    const out = parseAgentsDirectory({ agents: [{ ...AGENT_ROW, mint: 'So11111111111111111111111111111111111111112' }] });
    expect(out!.agents[0].status).toBe('launched');
    expect(out!.agents[0].mint).toBe('So11111111111111111111111111111111111111112');
  });
});

describe('badges', () => {
  test('grade tones match the trust page banding and unknown stays grey', () => {
    expect(gradeTone('A')).toBe('good');
    expect(gradeTone('D')).toBe('caution');
    expect(gradeTone('F')).toBe('bad');
    expect(gradeTone('unrated')).toBe('unknown');
    expect(gradeTone('S++')).toBe('unknown'); // an invented grade is not a good one
  });

  test('mintBadge never upgrades a claim to a fact', () => {
    expect(mintBadge({ mint: null, mintVerified: false }).tone).toBe('unknown');
    expect(mintBadge({ mint: 'x', mintVerified: false })).toEqual({ label: 'mint UNVERIFIED — creator claim', tone: 'caution' });
    expect(mintBadge({ mint: 'x', mintVerified: true }).tone).toBe('good');
  });
});

describe('parseAgentTrust', () => {
  test('a self-reported report keeps its provenance and disclaimer', () => {
    const t = parseAgentTrust({
      source: 'self-reported', verified: false, grade: 'B', score: 78, confidence: 0.8,
      checkedAt: 1725500000000, summary: 'ok', note: 'recompute it yourself', reportedBy: 'Signer111',
    });
    expect(t).toMatchObject({ kind: 'self-reported', grade: 'B', score: 78, note: 'recompute it yourself' });
  });

  test('a pre-launch view parses as pre-launch', () => {
    const t = parseAgentTrust({ source: 'pre-launch', grade: 'unrated', score: 0, confidence: 0, summary: 'nothing verified' });
    expect(t).toMatchObject({ kind: 'pre-launch', grade: 'unrated' });
  });

  test('an unknown source or missing grade is null — UNVERIFIED, never a grade', () => {
    expect(parseAgentTrust({ source: 'on-chain', grade: 'A' })).toBeNull();
    expect(parseAgentTrust({ source: 'self-reported', score: 99 })).toBeNull();
    expect(parseAgentTrust(null)).toBeNull();
  });
});

describe('parseAgentDetail', () => {
  test('pulls a displayable about out of the character without executing anything', () => {
    const d = parseAgentDetail({ ...AGENT_ROW, pledgeSigner: 'Signer111', character: { system: 'an npc who woke up' } });
    expect(d!.about).toBe('an npc who woke up');
    expect(d!.pledgeSigner).toBe('Signer111');
  });
  test('array bios join, non-strings are ignored, absence is null', () => {
    const d = parseAgentDetail({ ...AGENT_ROW, character: { bio: ['line one', 7, 'line two'] } });
    expect(d!.about).toBe('line one line two');
    expect(parseAgentDetail({ ...AGENT_ROW, character: {} })!.about).toBeNull();
  });
});

describe('parseMentions / parseGraph', () => {
  test('edges parse both directions; malformed tickers are dropped and counted', () => {
    const out = parseMentions({
      mentions: [{ from: 'NPC', to: 'FRIEND', note: 'we collab', created: 1 }],
      mentionedBy: [{ from: 'EVIL/../X', to: 'NPC', note: 'boo' }],
      degree: {},
    });
    expect(out!.mentions).toHaveLength(1);
    expect(out!.mentionedBy).toHaveLength(0);
    expect(out!.dropped).toBe(1);
  });

  test('a mention note is bounded — a 10k-char note cannot flood the page', () => {
    const out = parseGraph({ edges: [{ from: 'AA', to: 'BB', note: 'x'.repeat(10_000), created: 1 }] });
    expect(out!.edges[0].note!.length).toBeLessThanOrEqual(281);
  });

  test('unrecognised envelopes are null', () => {
    expect(parseMentions({})).toBeNull();
    expect(parseGraph({ agents: [] })).toBeNull();
  });
});

describe('parseListings + price formatting', () => {
  const LISTING = {
    id: LISTING_ID, kind: 'voice', publisher: 'Pub1111111111111111111111111111', title: 'kokoro pack',
    summary: 'a voice', license: 'MIT', price: { amount: 500_000_000, currency: 'SOL' },
    artifactSha256: 'b'.repeat(64), artifactBytes: 1024, artifactUrl: '/listings/x/artifact',
    status: 'listed', seq: 1, created: 5, updated: 5, integrity: 'sha256-verified', settlement: 'none',
  };

  test('a listing renders with its recorded price in words', () => {
    const out = parseListings({ listings: [LISTING] });
    expect(out!.listings[0]).toMatchObject({ kind: 'voice', title: 'kokoro pack', priceLabel: '0.5 SOL' });
  });

  test('prices: minor units, free, and refusal to invent a number', () => {
    expect(formatListingPrice({ amount: 0, currency: 'SOL' })).toBe('free');
    expect(formatListingPrice({ amount: 1_500_000, currency: 'USDC' })).toBe('1.5 USDC');
    expect(formatListingPrice({ amount: 1.5, currency: 'SOL' })).toBe('price unknown'); // non-integer minor units
    expect(formatListingPrice({ amount: 10, currency: 'DOGE' })).toBe('price unknown');
    expect(formatListingPrice(undefined)).toBe('price unknown');
  });

  test('a listing with a wrong id or kind is dropped and counted', () => {
    const out = parseListings({ listings: [LISTING, { ...LISTING, id: 'nope' }, { ...LISTING, kind: 'malware' }] });
    expect(out!.listings).toHaveLength(1);
    expect(out!.dropped).toBe(2);
  });
});

describe('link-out builders', () => {
  test('build only from shape-checked halves', () => {
    expect(agentJsonUrl('http://localhost:8790', 'NPC')).toBe('http://localhost:8790/agents/NPC');
    expect(agentJsonUrl('', 'NPC')).toBeNull(); // no registry configured ⇒ no link
    expect(agentJsonUrl('http://localhost:8790', '../admin')).toBeNull();
    expect(listingArtifactUrl('http://localhost:8790', LISTING_ID)).toBe(`http://localhost:8790/listings/${LISTING_ID}/artifact`);
    expect(listingArtifactUrl('http://localhost:8790', 'x')).toBeNull();
  });

  test('shortKey elides the middle, never the identity of short keys', () => {
    expect(shortKey('abcdefghijkl')).toBe('abcd…ijkl');
    expect(shortKey('short')).toBe('short');
  });
});

describe('REGISTRY config resolution', () => {
  test('trailing slashes are trimmed and unset means off', async () => {
    const load = async (v?: string) => {
      jest.resetModules();
      delete process.env.NEXT_PUBLIC_NPC_REGISTRY;
      if (v !== undefined) process.env.NEXT_PUBLIC_NPC_REGISTRY = v;
      return import('../config.ts');
    };
    expect((await load('http://localhost:8790///')).REGISTRY).toBe('http://localhost:8790');
    expect((await load()).REGISTRY).toBe('');
  });
});
