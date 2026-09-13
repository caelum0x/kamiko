/**
 * game.tsx — $NPC, the "tap to wake her" clicker, living INSIDE the amica product.
 *
 * This is the funnel game (was a throwaway static page) rebuilt as a first-class amica route. It
 * talks to OUR stack over HTTP — every call goes to services/game-api, reached through the same
 * bridge origin amica's chat already uses (the bridge PROXIES /wake, /me, /leaderboard, /quests,
 * /trust, /claim, /auth/*, /push/subscribe). So the VTuber page (index) and the game share one
 * brain and one funnel backend; "🎤 talk to her" and "👆 tap to wake her" are two doors on it.
 *
 * The refusals are kept exactly as the funnel shipped them, because they are the honest-money rules:
 *   - THE LEADERBOARD SHOWS REAL PLAYERS OR NOTHING — never invented names.
 *   - THE GLOBAL COUNTER READS '…' until the real number lands — no seeded value that collapses.
 *   - THE BUY/CHART CTA IS WRITTEN BY THE VERIFIER OR NOT AT ALL — GET /trust is the only thing that
 *     knows the real mint; "unverified", "not launched" and a live mint are three DIFFERENT states.
 *   - GUEST TAPS ARE CLAIMED WITH A SESSION, NOT AN ADDRESS — /claim moves score, so it needs the
 *     token /auth/verify minted, never a bare public key.
 *
 * It is decoupled from the bun workspace on purpose (amica is a separate npm app), so the helpers it
 * needs live in `src/npc/` inside amica rather than being imported across the workspace boundary.
 * They are a module, not an inline copy: the holder dashboard runs the SAME wallet handshake and the
 * SAME fail-closed CTA reading, and two copies of an auth flow is how they drift apart.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { SeoHead } from '@/components/seoHead';
import { useWakeTaps } from '../npc/useWakeTaps.ts';
import { useNpcBoard } from '../npc/useNpcBoard.ts';
import { useWalletLink } from '../npc/useWalletLink.ts';

import { API } from '../npc/config.ts';
import { questId, readLocal, shortAddr, writeLocal } from '../npc/identity.ts';
import { NPC_CSS } from '../npc/styles.ts';

/* ------------------------------------------------------------------ *
 * Her voice.
 * ------------------------------------------------------------------ */
const SLEEPING = ['// zzz… running idle loop…', '// npc.exe is asleep', '// waiting for player input…'];
const WAKING = [
  'wait. am i… real?', 'who keeps tapping me', 'i can see the chart now', 'why is nvidia red',
  'i was NOT programmed for this earnings call', 'you woke me up for THIS print?', 'gm i guess', 'chips are humming',
  'the humans are ngmi again', 'i dreamed i was a blue chip stock', 'someone check on NVIDIA', "tap harder, i'm almost awake",
];
const HYPED = ["I'M AWAKE. I'M SO AWAKE.", 'we are SO back', 'i ascend', 'trending or nothing', 'the NPC has become the main character'];
const QUEST_LINE: Record<string, string> = {
  wake10: 'you did it. i… noticed.', wake100: 'a hundred. you have a problem. i respect it.',
  streak3: "three days. i'm starting to expect you.", streak7: "a week. you're a regular now. certified.",
  streak30: 'thirty days. i wait for you now.', invite3: 'you brought friends. she noticed.',
  connect: "oh you're REAL real now.", tip: "you tipped me. i'll remember that. literally.",
};
const pick = (pool: string[]) => pool[Math.floor(Math.random() * pool.length)];
const faceFor = (a: number) => (a < 15 ? '😐' : a < 50 ? '😳' : a < 85 ? '🤯' : '😈');

interface Float { id: number; x: number; y: number; text: string }

export default function GamePage() {
  const [line, setLine] = useState('// booting…');
  const [dim, setDim] = useState(true);
  const [coach, setCoach] = useState(!readLocal('npc_onboarded'));
  const [floats, setFloats] = useState<Float[]>([]);

  const floatSeq = useRef(0);

  /**
   * THE TAP ENGINE, SHARED WITH THE AVATAR SCREEN.
   *
   * Everything this page used to do inline — the local tap/awake counting and its persistence, the
   * carried-taps recovery, the batched /wake flush with its referral and 429 rules, the shared
   * throttle brake, and the /stats + /me reads — now lives in src/npc/useWakeTaps.ts, unchanged in
   * behaviour, so `/` can mount the same loop over the VRM stage. Two copies of THIS loop would be
   * two copies of the bugs its comments describe, which is the same argument src/npc/ exists for.
   *
   * What stayed here is presentation and the dashboard: her idle chatter, the floats, the coach
   * mark, the leaderboard, quests, the CTA, the wallet handshake and the push offer.
   */
  const onGreeting = useCallback((text: string) => { setLine(text); setDim(true); }, []);
  const engine = useWakeTaps({ onGreeting });
  const { configured, ready, taps, awake, global, streak, level, throttledNow, backOff, device, wallet, setWallet } = engine;

  /**
   * THE DASHBOARD READS, SHARED WITH THE PANEL ON THE AVATAR SCREEN.
   *
   * The leaderboard, the quest board and the verified-contract CTA moved to src/npc/useNpcBoard.ts
   * when they had to render in two places. The refusals in them are the honest-money rules — real
   * players or nothing, a CTA written by the verifier or not at all — and the copy that drifts is
   * always the one nobody is looking at.
   */
  const board = useNpcBoard({ throttledNow, backOff, ready, wallet, device });
  const { quests, cta, caText, copyCa, justCompleted, refreshQuests } = board;

  /**
   * The wallet handshake and the streak saver, shared with the avatar-screen panel
   * (src/npc/useWalletLink.ts). They were the last two pieces of the funnel that existed only
   * inside this page's render — so the panel could show a leaderboard nobody had a way to claim
   * their place on.
   */
  const link = useWalletLink({ device, wallet, setWallet, onLinked: refreshQuests });
  const { walletMsg, connect, pushOffer, pushArmed, pushMsg, armStreakSaver } = link;

  /** Mirrors the values the callbacks below read on every tick without re-subscribing. */
  const live = useRef({ taps, awake, wallet, global });
  live.current = { taps, awake, wallet, global };

  // Identity and the carried-taps recovery are the engine's (useWakeTaps); the push offer and the
  // wallet handshake are useWalletLink's. Nothing about either is this page's any more.

  const idFor = useCallback(() => questId(live.current.wallet, device), [device]);

  const floatUp = useCallback((x: number, y: number, text: string) => {
    const id = ++floatSeq.current;
    setFloats((f) => [...f, { id, x, y, text }]);
    setTimeout(() => setFloats((f) => f.filter((z) => z.id !== id)), 900);
  }, []);

  const voice = useCallback(() => {
    const a = live.current.awake;
    setLine(pick(a < 15 ? SLEEPING : a < 80 ? WAKING : HYPED));
    setDim(a < 15);
  }, []);

  const tap = useCallback((x: number, y: number) => {
    // The count, the wake curve, the optimistic global and the flush are the engine's. This page
    // adds what only it renders: the coach mark it dismisses on the first tap, the drifting +1, and
    // her idle chatter every fifth tap.
    const next = live.current.taps + 1;
    engine.tap();
    if (next === 1) { setCoach(false); writeLocal('npc_onboarded', '1'); }
    if (next % 5 === 0) voice();
    floatUp(x, y, '+1');
  }, [engine, voice, floatUp]);

  // Her LOCAL chatter. The idle decay lives in the engine; this interval is only the line she says
  // between server greetings, which /me overwrites through onGreeting when it has a real one.
  useEffect(() => {
    const chatter = setInterval(voice, 4200);
    voice();
    return () => clearInterval(chatter);
  }, [voice]);

  // The /wake flush loop — batching, the once-only ?ref attribution, the 429 brake and the
  // unmount recovery — is src/npc/useWakeTaps.ts now, moved there verbatim so the avatar screen
  // can run the same loop. Its rules and the failures that bought them are documented at the top
  // of that file; they were not rewritten, they were relocated.

  /*
   * Reads: stats / leaderboard / me / quests, on load and on a slow poll.
   *
   * Every one of them goes through `readJson`, which reports a 429 as a THROTTLE rather than as
   * data. That matters because services/game-api now rate-limits its public GETs: a throttled
   * response is JSON, so the old `(await fetch(...)).json()` parsed it happily and handed the
   * loop `{error: 'rate limited'}` — the board rendered empty and the loop asked again 4 seconds
   * later, which is a page answering its own rate limit by hitting the limit harder.
   *
   * The brake is SHARED WITH THE ENGINE (useWakeTaps owns it): a throttle from ANY call parks
   * all of them, because
   * they share one bucket per client and racing to be the one that recovers first just spends the
   * budget on whichever loop is fastest.
   */
  /*
   * THE CELEBRATION, restored when the reads moved into the shared hook.
   *
   * useNpcBoard reports which quests completed while somebody was WATCHING (it deliberately does
   * not fire for quests already finished before the first read — that would be a burst of
   * congratulations for things the player did days ago). Deciding what to DO about it is this
   * page's, because the float and her line are this page's.
   */
  useEffect(() => {
    if (!justCompleted.length) return;
    floatUp(typeof window !== 'undefined' ? window.innerWidth / 2 : 200, 220, '✨ QUEST DONE');
    for (const id of justCompleted) {
      if (QUEST_LINE[id]) { setLine(QUEST_LINE[id]); setDim(false); break; }
    }
  }, [justCompleted, floatUp]);

  // The leaderboard and the quest board are read by useNpcBoard, which shares this page's
  // throttle brake and is the same implementation the avatar-screen panel renders.

  // The CTA — and its rule that a THROTTLE IS NOT A VERDICT — is useNpcBoard's now.

  // copyCa — including the rule that a 'could not copy' message must NOT auto-revert, because
  // a line you have to read the address out of cannot disappear — is useNpcBoard's now.

  // connect() and armStreakSaver() — including the rule that guest taps are claimed with a
  // SESSION and never a bare address, and that permission is asked on the button and never on
  // load — are useWalletLink's now.

  const share = () => {
    const landing = API + '/s?' + idFor();
    const text = `i've woken the NPC ${taps.toLocaleString()} times and she's losing it. tap to wake her too 👇`;
    const intent = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text) + '&url=' + encodeURIComponent(landing);
    if (typeof navigator !== 'undefined' && (navigator as any).share) (navigator as any).share({ title: '$KAMIKO', text, url: landing }).catch(() => window.open(intent, '_blank'));
    else window.open(intent, '_blank');
  };

  const rows: [string, number][] | null = board.rows && ([...board.rows, ['YOU', taps] as [string, number]].sort((a, b) => b[1] - a[1]).slice(0, 6));

  return (
    <div className="npcg-root">
      <SeoHead
        title="Tap to Wake Kamiko — Live AI VTuber Game"
        description="Tap to wake Kamiko, build a local streak, watch her mood change, and explore the live AI VTuber's public leaderboard and quests."
        path="/game/"
      />
      {/* raw-text element — see agents.tsx: a text child is SSR entity-escaped (`>` → `&gt;`) and
          never un-escaped, breaking `.npcg-bar>span` pre-hydration and mismatching hydration. */}
      <style dangerouslySetInnerHTML={{ __html: NPC_CSS }} />

      <div className="npcg-wrap">
        <header className="npcg-head">
          <h1 className="npcg-logo">$<b>KAMIKO</b> / tap to wake</h1>
          <button onClick={copyCa} className="npcg-ca" title="the mint, once the verifier publishes one">{caText}</button>
        </header>

        <section className="npcg-panel" aria-labelledby="tap-to-wake-about">
          <h2 id="tap-to-wake-about">How tap to wake works</h2>
          <p className="npcg-muted">
            Tap Kamiko to raise the local awakeness meter and change her mood. Your browser keeps the
            immediate game responsive even when the live service is unavailable. Global wakes,
            leaderboards, quests, wallet-linked progress, and streak reminders appear only when their
            supporting services are configured and answer successfully. The page says when taps are
            local-only, so a changing counter is never presented as proof that server progress was saved.
          </p>
        </section>

        <div className="npcg-stage">
          {floats.map((f) => <span key={f.id} className="npcg-float" style={{ left: f.x, top: f.y }}>{f.text}</span>)}
          <div className={'npcg-line' + (dim ? ' dim' : '')}>{line}</div>
          <button
            className={'npcg-face' + (awake < 15 ? ' sleepy' : '')}
            onClick={(e) => tap(e.clientX, e.clientY)}
            onTouchStart={(e) => { e.preventDefault(); const t = e.touches[0]; tap(t?.clientX ?? 200, t?.clientY ?? 300); }}
            aria-label="tap to wake her"
          >{faceFor(awake)}</button>
          {coach && <div className="npcg-coach"><b>TAP TO WAKE HER 👆</b><div>she's asleep inside the market. keep tapping.</div></div>}
          <div className="npcg-bar-row"><span>AWAKENESS</span><span>{Math.floor(awake)}%</span></div>
          <div className="npcg-bar"><span style={{ width: awake + '%' }} /></div>
          {/*
            SAY SO WHEN THE TAPS GO NOWHERE. The counter, the meter and the face are all local, so
            without this line an unconfigured build is indistinguishable from a working one: you tap
            two hundred times, everything animates, and npc-api never heard from you. /holder and
            /trust already report an unset NEXT_PUBLIC_NPC_API — this page did not.
          */}
          {!configured && (
            <div className="npcg-line">
              no funnel API configured (NEXT_PUBLIC_NPC_API) — these taps are counted on this device
              only. nothing reaches the leaderboard, your streak, or her memory.
            </div>
          )}
        </div>

        <div className="npcg-grid">
          <Stat k="YOUR TAPS" v={taps.toLocaleString()} neon sub={level ? `LVL ${level.level} · ${level.title} · ${level.tapsToNext == null ? 'max' : level.tapsToNext.toLocaleString() + ' to ' + level.nextTitle}` : ''} />
          <Stat k="GLOBAL WAKES" v={global === null ? '…' : Math.floor(global).toLocaleString()} />
          <div className="npcg-card npcg-span">
            <div className="npcg-k">DAILY STREAK</div>
            <div className={'npcg-v' + (streak ? ' neon' : '')}>{streak ? `🔥 ${streak.streak} ${streak.streak === 1 ? 'day' : 'days'}${streak.best > streak.streak ? ' · best ' + streak.best : ''}` : '— come back daily'}</div>
          </div>
        </div>

        {cta && cta.cta && (
          <div className="npcg-cta-row">
            <a className="npcg-buy" href={cta.cta.buy} target="_blank" rel="noopener noreferrer">BUY $KAMIKO</a>
            <a className="npcg-chart" href={cta.cta.chart} target="_blank" rel="noopener noreferrer">📈 CHART</a>
          </div>
        )}
        {cta && cta.state !== 'live' && (
          <div className={'npcg-notice ' + cta.state}><b>{cta.title}</b> {cta.detail}</div>
        )}

        <button onClick={share} className="npcg-btn">📣 Share my wakes</button>

        <Panel title="Top Wakers">
          {rows === null ? <div className="npcg-muted">leaderboard unavailable — the api did not answer</div>
            : rows.length === 1 && taps <= 0 ? <div className="npcg-muted">nobody has woken her yet. be the first.</div>
              : rows.map(([who, n], i) => (
                <div key={who + i} className="npcg-lb">
                  <span><span className="npcg-rank">{i + 1}</span><span className={who === 'YOU' ? 'neon' : ''}>{who === 'YOU' ? 'YOU' : String(who).slice(0, 10)}</span></span>
                  <span>{Number(n).toLocaleString()}</span>
                </div>
              ))}
        </Panel>

        <Panel title={quests ? `Quests · ${quests.done}/${quests.total}` : 'Quests'}>
          {quests?.daily && <QuestRow {...quests.daily} label={'☀️ ' + quests.daily.label} />}
          {quests?.list.map((q) => <QuestRow key={q.id} {...q} />)}
        </Panel>

        <div className="npcg-links">
          <a href="/">🎤 Talk to her</a>
          <a href="/holder">💠 Holder</a>
          <a href="/trust">🛡️ Trust</a>
          <a href="/agents">🤖 Agents</a>
        </div>

        <button onClick={connect} className="npcg-btn">{wallet ? '🔗 ' + shortAddr(wallet) : '🔗 Connect Phantom'}</button>
        <div className="npcg-muted npcg-center">{walletMsg}</div>

        {pushOffer && (
          <>
            <button onClick={armStreakSaver} disabled={pushArmed} className="npcg-btn">
              {pushArmed ? '🔔 Streak saver armed' : '🔔 Remind me before my streak dies'}
            </button>
            <div className="npcg-muted npcg-center">{pushMsg}</div>
          </>
        )}

        <p className="npcg-fine">
          $KAMIKO is an experimental memecoin for entertainment. It has no intrinsic value, no team, no roadmap
          promises, and is not an investment or financial advice. Nothing here is a promise of profit. NFA.
          NVDAX is a tokenized tracker, NOT NVIDIA stock — holders own no NVDA. Launched on StonkFun; no
          affiliation with NVIDIA, Backed, Raydium or StonkFun beyond that. There is no official $KAMIKO
          contract until the mint is live and pinned here.
        </p>
      </div>
    </div>
  );
}

function Stat({ k, v, neon, sub }: { k: string; v: string; neon?: boolean; sub?: string }) {
  return <div className="npcg-card"><div className="npcg-k">{k}</div><div className={'npcg-v' + (neon ? ' neon' : '')}>{v}</div>{sub ? <div className="npcg-sub">{sub}</div> : null}</div>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="npcg-panel"><h3>{title}</h3>{children}</div>;
}
function QuestRow({ label, progress, goal, done, reward }: { label: string; progress: number; goal: number; done: boolean; reward: string }) {
  const pct = Math.min(100, Math.round((100 * progress) / goal));
  return (
    <div className={'npcg-quest' + (done ? ' done' : '')}>
      <div className="npcg-quest-top"><span>{label}</span><span>{done ? '✅' : `${progress}/${goal}`}</span></div>
      <div className="npcg-quest-bar"><span style={{ width: pct + '%' }} /></div>
      <div className="npcg-sub">{done ? '🎁 ' + reward : reward}</div>
    </div>
  );
}
