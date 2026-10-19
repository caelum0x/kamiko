import { SeoHead } from '@/components/seoHead';
import { StaticPage } from '@/components/staticPage';

const TITLE = 'Kamiko changelog';
const DESCRIPTION = 'What shipped on Kamiko, the live AI VTuber, release by release.';

const ENTRIES = [
  {
    date: '2026-10-15',
    title: 'Market-reaction now speaks',
    body: 'A meaningful $KAMIKO/NVDAx price crossing gets a spoken, in-character line from Kamiko, not just a number on the panel — generated live, degrading honestly to a deterministic fallback line when no model key is configured.',
  },
  {
    date: '2026-10-08',
    title: 'Branding and canonical cleanup',
    body: "Kamiko's name made it into the page title, og:site_name and structured data consistently, and www/http requests now redirect to the canonical https://kamiko.fun.",
  },
  {
    date: '2026-09-14',
    title: 'One screen, no dead ends',
    body: "Removed old funnel pages that led away from the avatar. The site is now the VTuber, chat, and tap-to-wake game on one screen — including a crash screen that still tells you what Kamiko is if the 3D stage fails to load.",
  },
  {
    date: '2026-09-14',
    title: '"What is this?" answered in place',
    body: 'A panel on the stage menu explains what Kamiko is and what you can do, without leaving the avatar — the same prose a search engine and a screen reader see.',
  },
  {
    date: '2026-09-10',
    title: 'Emotes and a stage that isn\'t black',
    body: 'Kamiko reacts with emotes from the menu, and the backdrop is no longer a blank screen by default.',
  },
  {
    date: '2026-09-10',
    title: 'Operator puppeteering',
    body: "Opt-in: drive Kamiko's face live from your webcam.",
  },
  {
    date: '2026-09-10',
    title: 'The $KAMIKO relaunch',
    body: 'Kamiko relaunched paired with NVDAx on a Raydium LaunchLab bonding curve via StonkFun, with the dev launcher and old fair-launch framing removed.',
  },
  {
    date: '2026-09-08',
    title: 'The clicker moved onto the avatar screen',
    body: 'The tap-to-wake game, wallet, and streak tracking all moved onto the main avatar screen — no more navigating to a separate /game page.',
  },
] as const;

export default function Changelog() {
  return (
    <>
      <SeoHead title={TITLE} description={DESCRIPTION} path="/changelog" websiteSchema />
      <StaticPage eyebrow="changelog" title="Changelog">
        <ol className="space-y-6">
          {ENTRIES.map(({ date, title, body }) => (
            <li key={date + title}>
              <time dateTime={date} className="text-xs uppercase tracking-widest text-white/50">
                {date}
              </time>
              <p className="mt-1 font-semibold text-white">{title}</p>
              <p className="mt-1 text-white/80">{body}</p>
            </li>
          ))}
        </ol>
      </StaticPage>
    </>
  );
}
