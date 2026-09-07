/**
 * game.tsx — the clicker no longer lives on its own bare route. It now runs ON the main stage
 * (pages/index.tsx): tapping the live VTuber IS the wake action, with a HUD and an expandable
 * stats/quests overlay. This route stays only as a client redirect to "/", so old /game links,
 * bookmarks and shared cards still land on the unified experience.
 *
 * A client-side redirect keeps this SSG-compatible under `output: export` — nothing is rendered on
 * the server beyond a minimal $KAMIKO splash.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function GameRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/');
  }, [router]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#06060b',
        color: '#00ffa3',
        fontFamily: 'ui-monospace,Menlo,Consolas,monospace',
        fontSize: 15,
        letterSpacing: '0.02em',
      }}
    >
      <span style={{ color: 'rgba(255,255,255,0.45)' }}>$</span>
      <span style={{ textShadow: '0 0 18px rgba(0,255,163,0.45)' }}>KAMIKO</span>
    </div>
  );
}
