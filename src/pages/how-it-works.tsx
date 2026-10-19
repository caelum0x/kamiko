import { SeoHead } from '@/components/seoHead';
import { StaticPage } from '@/components/staticPage';

const TITLE = 'How Kamiko works: a VRM avatar, an LLM personality and a tap-to-wake game';
const DESCRIPTION =
  'How Kamiko works under the hood: the VRM avatar and voice pipeline, the chat/LLM personality, the tap-to-wake clicker, and how market signals reach the avatar.';

export default function HowItWorks() {
  return (
    <>
      <SeoHead title={TITLE} description={DESCRIPTION} path="/how-it-works" websiteSchema />
      <StaticPage eyebrow="how it works" title="How Kamiko works">
        <p>
          Everything on <a href="/">kamiko.fun</a> runs in one browser tab, on one screen — there is
          no separate game page or chat page to navigate to. Here is what each part is actually
          doing.
        </p>

        <h2>The avatar</h2>
        <p>
          Kamiko is a VRM 3D model, rendered live in WebGL. She lip-syncs to her own spoken replies,
          plays emotes you pick from the menu, and can be driven by your webcam (operator
          puppeteering) if you opt in — nothing about vision or camera access is on by default.
        </p>

        <h2>Chat and voice</h2>
        <p>
          Talk to her by typing or by voice. Your message goes through a chat backend (an LLM) that
          answers in character, and the reply comes back as both text and spoken audio, synced to
          her face. The same reply path is used whether you typed, spoke, or tapped — one pipeline,
          not three.
        </p>

        <h2>The tap-to-wake game</h2>
        <p>
          A clicker panel sits over the avatar: tapping it changes her mood and counts toward a
          level, daily quests, and a leaderboard. It is the same screen as the chat — there is no
          separate <code>/game</code> route to leave the avatar for.
        </p>

        <h2>Market signals</h2>
        <p>
          Kamiko is paired with $KAMIKO, a token tracked against NVDAx. When the pairing crosses a
          meaningful move, she can react to it in character — a spoken line, not just a number on
          screen. The bonding-curve progress shown on the tap panel comes from Raydium LaunchLab's
          own reading of how close $KAMIKO is to graduating off the curve. See the{' '}
          <a href="/token">token page</a> for how to verify the contract before treating any of this
          as financial information.
        </p>
      </StaticPage>
    </>
  );
}
