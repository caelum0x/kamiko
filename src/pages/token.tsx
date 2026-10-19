/**
 * token.tsx — "the trust page" the rest of the app already refers to.
 *
 * cta.ts and the copy in useNpcBoard.ts / useWakeGame.ts repeatedly tell a visitor to "check the
 * trust page" or "read the trust page before you buy" — that page did not exist as a route before
 * this file. Rather than write a second, different set of rules for what this page is allowed to
 * say about the contract, it reuses the exact same pure functions (`ctaState`, `caLabel`) that the
 * tap-to-wake panel uses, pointed at the same `GET /trust` verifier. One source of truth for what
 * gets said about the mint, not two that can drift.
 *
 * The risk disclosure below is static, server-rendered prose — present and crawlable whether or not
 * the live fetch below it ever resolves.
 */
import { useEffect, useState } from 'react';
import { SeoHead } from '@/components/seoHead';
import { StaticPage } from '@/components/staticPage';
import { API, readJson } from '@/npc/config';
import { caLabel, ctaState, type CtaState } from '@/npc/cta';

const TITLE = '$KAMIKO token — contract, verification and risk | Kamiko';
const DESCRIPTION =
  '$KAMIKO is a Solana token tracked against NVDAx, paired to the Kamiko AI VTuber. How to verify the real contract address, and the risks before you buy.';

function LiveContract() {
  const [state, setState] = useState<CtaState | 'loading' | 'unavailable'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!API) {
        if (!cancelled) setState('unavailable');
        return;
      }
      const r = await readJson<unknown>(`${API}/trust`, { headers: { accept: 'application/json' } });
      if (cancelled) return;
      setState(ctaState(r.ok ? r.data : null));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') {
    return <p className="text-white/60">checking the on-chain verifier…</p>;
  }
  if (state === 'unavailable') {
    return (
      <p className="text-white/70">
        the live verifier isn't reachable from this build. open{' '}
        <a href="/">the main stage</a> and check the tap-to-wake panel directly, or verify the mint
        yourself before trusting any address.
      </p>
    );
  }

  return (
    <div className="rounded-xl border border-white/15 bg-white/5 p-4">
      <p className="font-semibold text-white">{state.title}</p>
      <p className="mt-1 text-white/80">{state.detail}</p>
      {state.cta ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <code className="rounded bg-black/60 px-2 py-1 text-xs text-white/85">{caLabel(state)}</code>
          <a href={state.cta.buy} target="_blank" rel="noopener noreferrer" className="text-sm">
            buy →
          </a>
          <a href={state.cta.chart} target="_blank" rel="noopener noreferrer" className="text-sm">
            chart →
          </a>
        </div>
      ) : null}
    </div>
  );
}

export default function Token() {
  return (
    <>
      <SeoHead title={TITLE} description={DESCRIPTION} path="/token" websiteSchema />
      <StaticPage eyebrow="token" title="$KAMIKO: verify before you buy">
        <p>
          $KAMIKO is a Solana token tracked against NVDAx (a tokenized NVIDIA price tracker, not
          NVIDIA stock), launched on a Raydium LaunchLab bonding curve. It is paired with the Kamiko
          AI VTuber, which can react in character to its price moves — but holding $KAMIKO is never
          required to use the avatar, chat, or tap-to-wake game at <a href="/">kamiko.fun</a>.
        </p>

        <h2>The real contract, live</h2>
        <p>
          This section is read directly from Kamiko's own on-chain verifier — the same check that
          gates the buy link on the tap-to-wake panel. It will say plainly if no contract has
          launched yet, if the verifier can't be reached, or if it graded the token unsafe. No
          contract address on this site is ever hand-typed.
        </p>
        <LiveContract />

        <h2>How to not get scammed</h2>
        <ul>
          <li>
            Only trust a $KAMIKO contract address shown here or on the live tap-to-wake panel at
            kamiko.fun — never one sent in a reply, comment, or DM claiming to be Kamiko or the
            team.
          </li>
          <li>
            If this page says "not launched" or "unverified", there is no address worth trusting yet
            — anything calling itself $KAMIKO at that point is not this project.
          </li>
          <li>A verified contract still does not make $KAMIKO safe to buy; it only means the mint on this page is the real one.</li>
        </ul>

        <h2>Risk disclosure</h2>
        <p>
          $KAMIKO is a highly speculative token on a bonding-curve launch mechanism. It is not an
          investment product, has no guaranteed value or liquidity, and NVDAx is a third-party
          synthetic tracker, not NVIDIA stock or an NVIDIA-affiliated asset. Prices on a bonding
          curve can move sharply in either direction, including to zero. Nothing on this page or on
          kamiko.fun is financial advice — do your own research and only risk what you can afford to
          lose.
        </p>
      </StaticPage>
    </>
  );
}
