/**
 * staticPage.tsx — the shared shell for Kamiko's text-only, server-rendered pages.
 *
 * `/` is a WebGL stage with ~177 words of prose behind it (aboutPanel.tsx). That is enough for a
 * crawler to confirm the page is about a real product, but it is not enough surface for a search
 * engine to rank Kamiko against "what is an AI vtuber" or "$KAMIKO token" queries, or for a visitor
 * who lands on a search result to read anything before the ~800kB stage bundle boots. These pages
 * are plain HTML: no WebGL, no ViewerContext, nothing that needs the stage to be alive. They render
 * instantly, pre-hydration, same as AboutDocument does for `/`.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

const EYEBROW = 'text-[10px] uppercase tracking-widest text-white/50';

export const PAGE_NAV = [
  { href: '/about', label: 'about' },
  { href: '/how-it-works', label: 'how it works' },
  { href: '/token', label: '$KAMIKO token' },
  { href: '/faq', label: 'faq' },
  { href: '/changelog', label: 'changelog' },
] as const;

interface StaticPageProps {
  eyebrow: string;
  title: string;
  children: ReactNode;
}

/** The shared shell: dark stage background, a way back to the live avatar, and cross-links to the
 * rest of the text pages so none of them is an orphan. */
export function StaticPage({ eyebrow, title, children }: StaticPageProps) {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <Link
          href="/"
          className="text-[11px] font-semibold uppercase tracking-widest text-emerald-300/90 hover:text-emerald-200"
        >
          ← back to Kamiko
        </Link>

        <div className={`${EYEBROW} mt-6`}>{eyebrow}</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>

        <div className="prose-invert mt-6 space-y-5 text-sm leading-relaxed text-white/85 [&_a]:text-emerald-300 [&_a:hover]:text-emerald-200 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-white [&_li]:mt-1 [&_ul]:list-disc [&_ul]:pl-5">
          {children}
        </div>

        <nav aria-label="more about Kamiko" className="mt-12 border-t border-white/15 pt-4">
          <div className={EYEBROW}>more</div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            {PAGE_NAV.map(({ href, label }) => (
              <li key={href}>
                <Link href={href} className="text-white/70 hover:text-white">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

export default StaticPage;
