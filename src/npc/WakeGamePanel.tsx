/**
 * WakeGamePanel.tsx — the richer "$KAMIKO" surface (stats, leaderboard, quests, buy/chart CTA,
 * share, wallet connect, streak-saver) rendered as an expandable overlay on the live stage.
 *
 * It is the same presentation the old game.tsx page shipped, driven by the shared useWakeGame hook
 * so nothing is lost when the clicker moved onto the VTuber stage. Wrapped in `.npcg-root` so the
 * scoped NPC_CSS tokens (--neon/--violet/--line/…) resolve for every npcg- child.
 */
import type { WakeGame } from './useWakeGame.ts';
import {
  BellIcon, ChartIcon, CheckIcon, FlameIcon, GiftIcon,
  LinkIcon, MicIcon, ShareIcon,
} from './icons.tsx';
import { shortAddr } from './identity.ts';

interface WakeGamePanelProps {
  game: WakeGame;
  onClose: () => void;
}

export function WakeGamePanel({ game, onClose }: WakeGamePanelProps) {
  const {
    taps, global, streak, level, cta, caText, copyCa, rows, quests, wallet, walletMsg, connect,
    share, pushOffer, pushArmed, pushMsg, armStreakSaver,
  } = game;

  return (
    <div className="npcg-root" style={{ zIndex: 70 }} role="dialog" aria-label="$KAMIKO stats and quests">
      <div className="npcg-wrap">
        <header className="npcg-head">
          <div className="npcg-logo">$<b>KAMIKO</b></div>
          <button onClick={onClose} className="npcg-ca" aria-label="back to the stage">close ✕</button>
        </header>

        <button onClick={copyCa} className="npcg-btn" title="the mint, once the verifier publishes one" style={{ marginTop: 0 }}>{caText}</button>

        <div className="npcg-grid">
          <Stat k="YOUR TAPS" v={taps.toLocaleString()} neon sub={level ? `LVL ${level.level} · ${level.title} · ${level.tapsToNext == null ? 'max' : level.tapsToNext.toLocaleString() + ' to ' + level.nextTitle}` : ''} />
          <Stat k="GLOBAL WAKES" v={global === null ? '…' : Math.floor(global).toLocaleString()} />
          <div className="npcg-card npcg-span">
            <div className="npcg-k">DAILY STREAK</div>
            <div className={'npcg-v' + (streak ? ' neon' : '')}>{streak ? <><FlameIcon /> {streak.streak} {streak.streak === 1 ? 'day' : 'days'}{streak.best > streak.streak ? ' · best ' + streak.best : ''}</> : '— come back daily'}</div>
          </div>
        </div>

        {cta && cta.cta && (
          <div className="npcg-cta-row">
            <a className="npcg-buy" href={cta.cta.buy} target="_blank" rel="noopener noreferrer">BUY $KAMIKO</a>
            <a className="npcg-chart" href={cta.cta.chart} target="_blank" rel="noopener noreferrer"><ChartIcon /> CHART</a>
          </div>
        )}
        {cta && cta.state !== 'live' && (
          <div className={'npcg-notice ' + cta.state}><b>{cta.title}</b> {cta.detail}</div>
        )}

        <button onClick={share} className="npcg-btn"><ShareIcon /> Share my wakes</button>

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
          {quests?.daily && <QuestRow {...quests.daily} label={quests.daily.label} daily />}
          {quests?.list.map((q) => <QuestRow key={q.id} {...q} />)}
        </Panel>

        {/* Single-page: "Talk to her" just returns to the stage where the live chat lives — it does
            NOT navigate to another route. Holder/tips (Connect Phantom below) and trust (the CTA /
            notice above) are folded into THIS panel, so there are no route-changing links. */}
        <div className="npcg-links">
          <button type="button" onClick={onClose}><MicIcon /> Talk to her</button>
        </div>

        <button onClick={connect} className="npcg-btn"><LinkIcon /> {wallet ? shortAddr(wallet) : 'Connect Phantom'}</button>
        <div className="npcg-muted npcg-center">{walletMsg}</div>

        {pushOffer && (
          <>
            <button onClick={armStreakSaver} disabled={pushArmed} className="npcg-btn">
              <BellIcon /> {pushArmed ? 'Streak saver armed' : 'Remind me before my streak dies'}
            </button>
            <div className="npcg-muted npcg-center">{pushMsg}</div>
          </>
        )}

        <p className="npcg-fine">
          Not financial advice. $KAMIKO isn&apos;t live yet — no official contract exists.
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
function QuestRow({ label, progress, goal, done, reward, daily }: { label: string; progress: number; goal: number; done: boolean; reward: string; daily?: boolean }) {
  const pct = Math.min(100, Math.round((100 * progress) / goal));
  return (
    <div className={'npcg-quest' + (done ? ' done' : '')}>
      <div className="npcg-quest-top"><span>{daily ? <span className="npcg-daily">DAILY</span> : null}{label}</span><span>{done ? <CheckIcon /> : `${progress}/${goal}`}</span></div>
      <div className="npcg-quest-bar"><span style={{ width: pct + '%' }} /></div>
      <div className="npcg-sub">{done ? <><GiftIcon /> {reward}</> : reward}</div>
    </div>
  );
}
