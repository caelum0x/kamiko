/**
 * publishListing.spec.ts — publishing a marketplace listing from the browser (NEXT-PHASES.md P1#5).
 *
 * Two things are being protected here.
 *
 * FIRST, THE MIRRORED VOCABULARIES. The front end is a separate npm package and cannot import
 * across the workspace boundary, so the listing kinds, licences and currencies are copies of the
 * registry's. A copy of a closed vocabulary rots in both directions: a value the registry added
 * and this did not is one nobody can pick, and a value here that the registry does not know is a
 * dropdown entry that always fails with a 422. The first block reads the registry's own source and
 * fails the build when they disagree.
 *
 * SECOND, THE MONEY AND THE PROBE. `toMinorUnits` turns a typed price into the integer the
 * registry stores, and `readProbe` decides whether an unsigned POST came back with the exact bytes
 * to sign or with a real refusal. Both are pure, and both are places where being approximately
 * right is worse than failing.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  LISTING_CURRENCIES,
  LISTING_KINDS,
  LISTING_LICENSES,
  MAX_ARTIFACT_BYTES,
  buildListingDoc,
  draftProblems,
  readProbe,
  toBase64,
  toMinorUnits,
  type ListingDraft,
} from '@/npc/publish';

/** The registry's own source, read rather than imported — it is in the other package. */
const REGISTRY_SRC = readFileSync(
  join(__dirname, '..', '..', '..', 'services', 'registry', 'listings.ts'),
  'utf8',
);

/** Pull a `export const NAME = [ ... ] as const;` array of string literals out of that source. */
function vocabulary(name: string): string[] {
  const m = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(REGISTRY_SRC);
  if (!m) throw new Error(`${name} not found in services/registry/listings.ts — the mirror guard cannot see it any more`);
  return Array.from(m[1]!.matchAll(/'([^']+)'/g), (x) => x[1]!);
}

describe('the mirrored vocabularies still match the registry', () => {
  it('reads a real registry source, so a moved file cannot make this pass by finding nothing', () => {
    // The anchor. Every assertion below compares against something parsed out of that file.
    expect(REGISTRY_SRC.length).toBeGreaterThan(2000);
    expect(REGISTRY_SRC).toContain('kamiko.listing');
  });

  it('kinds match', () => {
    expect([...LISTING_KINDS]).toEqual(vocabulary('LISTING_KINDS'));
  });

  it('licences match — a licence only one side knows is a dropdown entry that always 422s', () => {
    expect([...LISTING_LICENSES]).toEqual(vocabulary('LISTING_LICENSES'));
  });

  it('currencies match', () => {
    expect([...LISTING_CURRENCIES]).toEqual(vocabulary('LISTING_CURRENCIES'));
  });

  it('the artifact ceiling matches', () => {
    const m = /export const MAX_ARTIFACT_BYTES = ([^;]+);/.exec(REGISTRY_SRC);
    expect(m).not.toBeNull();
    // eslint-disable-next-line no-eval
    expect(MAX_ARTIFACT_BYTES).toBe(eval(m![1]!) as number);
  });
});

describe('toMinorUnits — a price somebody may be asked to pay', () => {
  it('converts whole units to integer minor units', () => {
    expect(toMinorUnits('1', 'SOL')).toBe(1_000_000_000);
    expect(toMinorUnits('0', 'SOL')).toBe(0);
    expect(toMinorUnits('2.5', 'USDC')).toBe(2_500_000);
  });

  it('does not let binary floating point reach the wire', () => {
    // 0.1 * 1e9 is 100000000.00000001 in IEEE-754, and a non-integer is a 422 from the registry.
    expect(toMinorUnits('0.1', 'SOL')).toBe(100_000_000);
    expect(Number.isSafeInteger(toMinorUnits('0.3', 'SOL')!)).toBe(true);
    expect(Number.isSafeInteger(toMinorUnits('0.07', 'USDC')!)).toBe(true);
  });

  it('refuses rather than guesses at anything that is not a price', () => {
    for (const bad of ['', '  ', 'free', '-1', '1e9', '1,5', '.', 'NaN', '1.2.3', '+1']) {
      expect(toMinorUnits(bad, 'SOL')).toBeNull();
    }
  });

  it('refuses more precision than the currency has, rather than truncating it', () => {
    // Silently rounding somebody's asking price down is worse than refusing it.
    expect(toMinorUnits('0.0000000001', 'SOL')).toBeNull();
    expect(toMinorUnits('0.0000001', 'USDC')).toBeNull();
    // Exactly the currency's precision is fine.
    expect(toMinorUnits('0.000000001', 'SOL')).toBe(1);
    expect(toMinorUnits('0.000001', 'USDC')).toBe(1);
  });
});

describe('draftProblems — what to fix, in the order a person would fix it', () => {
  const good: ListingDraft = {
    kind: 'character', title: 'Kamiko', summary: 'a VTuber', license: 'MIT', price: '0', currency: 'SOL',
  };

  it('is silent on a valid draft', () => {
    expect(draftProblems(good, 1024)).toEqual([]);
  });

  it('names each missing piece', () => {
    expect(draftProblems({ ...good, title: '  ' }, 10)[0]).toMatch(/title/i);
    expect(draftProblems({ ...good, summary: '' }, 10)[0]).toMatch(/summary/i);
    expect(draftProblems({ ...good, price: 'free' }, 10)[0]).toMatch(/price/i);
  });

  it('catches the file before a wallet is ever opened', () => {
    // Every one of these would otherwise be found by the registry, after two signatures.
    expect(draftProblems(good, null)[0]).toMatch(/choose the file/i);
    expect(draftProblems(good, 0)[0]).toMatch(/empty/i);
    expect(draftProblems(good, MAX_ARTIFACT_BYTES + 1)[0]).toMatch(/at most/i);
    expect(draftProblems(good, MAX_ARTIFACT_BYTES)).toEqual([]);
  });
});

describe('buildListingDoc', () => {
  const draft: ListingDraft = {
    kind: 'plugin', title: '  Spaced  ', summary: '  also spaced ', license: 'MIT', price: '1.5', currency: 'SOL',
  };

  it('carries exactly the keys the registry accepts, trimmed', () => {
    const doc = buildListingDoc(draft, 'PUB', 'abc123', 42, 'pending');
    // The registry REFUSES unknown keys rather than dropping them, because it stores and re-serves
    // the document verbatim — so an extra key here is a listing that can never be published.
    expect(Object.keys(doc).sort()).toEqual(
      ['artifactBytes', 'artifactSha256', 'kind', 'license', 'price', 'publisher', 'schema', 'status', 'summary', 'title', 'version'].sort(),
    );
    expect(doc.title).toBe('Spaced');
    expect(doc.summary).toBe('also spaced');
    expect(doc.price).toEqual({ amount: 1_500_000_000, currency: 'SOL' });
    expect(doc.status).toBe('pending');
  });

  it('differs from the create only in status when publishing', () => {
    // The second signature covers the SAME document with status "listed". Anything else changing
    // between the two writes moves the content address and the update is refused with a 409.
    const a = buildListingDoc(draft, 'PUB', 'abc123', 42, 'pending');
    const b = buildListingDoc(draft, 'PUB', 'abc123', 42, 'listed');
    expect({ ...a, status: 'x' }).toEqual({ ...b, status: 'x' });
  });
});

describe('readProbe — the unsigned POST that asks for the exact bytes to sign', () => {
  const probe = (status: number, body: Record<string, unknown>) => readProbe({ status, body });

  it('takes the message, id and seq out of the expected 401', () => {
    const r = probe(401, { signedMessage: 'I publish kamiko listing v1 …', id: 'a'.repeat(64), expectedSeq: 1 });
    expect(r).toEqual({ ok: true, message: 'I publish kamiko listing v1 …', id: 'a'.repeat(64), seq: 1 });
  });

  it('refuses to continue if an unsigned write was ACCEPTED', () => {
    // That would be a serious server bug, and signing afterwards could not undo it. Stop loudly.
    const r = probe(200, { ok: true, id: 'a'.repeat(64) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toMatch(/unsigned write/i);
  });

  it('surfaces a real refusal as itself, rather than retrying with a signature that cannot help', () => {
    // A malformed document (422) or an already-listed artifact (409) is not fixed by signing.
    const r = probe(409, { error: 'this publisher has already listed this artifact under this kind' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toMatch(/already listed/);
  });

  it('does not sign a half-formed reply', () => {
    // Missing any one of the three makes the commit unbuildable; guessing a seq is a replay.
    expect(probe(401, { signedMessage: 'm', id: 'i' }).ok).toBe(false);
    expect(probe(401, { signedMessage: 'm', expectedSeq: 1 }).ok).toBe(false);
    expect(probe(401, { id: 'i', expectedSeq: 1 }).ok).toBe(false);
    expect(probe(401, {}).ok).toBe(false);
  });
});

describe('toBase64', () => {
  it('round-trips through the browser decoder', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 65, 66]);
    expect(Uint8Array.from(atob(toBase64(bytes)), (c) => c.charCodeAt(0))).toEqual(bytes);
  });

  it('handles an artifact at the ceiling without overflowing the argument limit', () => {
    // `String.fromCharCode(...bytes)` on a 48 KB array throws in some engines — a crash that only
    // ever appears on a big file, which is the file somebody cares about.
    const big = new Uint8Array(MAX_ARTIFACT_BYTES).fill(7);
    expect(atob(toBase64(big)).length).toBe(MAX_ARTIFACT_BYTES);
  });
});
