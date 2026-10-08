import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { canonicalRedirect } from './worker.mjs';

const assets = { fetch: () => new Response('ok') };

test('www and http redirect to https apex, keeping path and query', async () => {
  for (const [from, to] of [
    ['https://www.kamiko.fun/game/?a=1', 'https://kamiko.fun/game/?a=1'],
    ['http://kamiko.fun/', 'https://kamiko.fun/'],
    ['http://www.kamiko.fun/x', 'https://kamiko.fun/x'],
  ]) {
    const res = await worker.fetch(new Request(from), { ASSETS: { fetch: () => assert.fail('no asset') } });
    assert.equal(res.status, 301);
    assert.equal(res.headers.get('location'), to);
  }
});

test('https apex and preview hosts are served from assets', async () => {
  for (const u of ['https://kamiko.fun/', 'https://kamiko-site.example.workers.dev/']) {
    assert.equal(canonicalRedirect(u), null);
    assert.equal((await worker.fetch(new Request(u), { ASSETS: assets })).status, 200);
  }
});
