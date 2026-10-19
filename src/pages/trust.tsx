/**
 * trust.tsx — cta.ts, useNpcBoard.ts and useWakeGame.ts all tell a visitor to "check the trust
 * page", a route that never existed until token.tsx was added. Rather than duplicate that content
 * under a second URL (and split whatever ranking signal either page earns), this is a thin redirect
 * to the real page, noindexed so /token stays the one canonical answer to "check the trust page".
 */
import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { SeoHead } from '@/components/seoHead';

export default function Trust() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/token');
  }, [router]);

  return (
    <>
      <SeoHead title="Redirecting to the $KAMIKO token page" description="" path="/trust" noindex />
      <div className="flex min-h-screen items-center justify-center bg-black text-white/70">
        <p>
          Moved to <a href="/token" className="text-emerald-300">kamiko.fun/token</a>.
        </p>
      </div>
    </>
  );
}
