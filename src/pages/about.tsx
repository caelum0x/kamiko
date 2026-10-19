import { SeoHead } from '@/components/seoHead';
import { StaticPage } from '@/components/staticPage';

const TITLE = 'What is Kamiko? | Kamiko AI VTuber';
const DESCRIPTION =
  'Kamiko is a 3D AI VTuber you can talk to by chat or voice, right in your browser — no download, wallet, or signup. Built on the open-source Amica project.';

export default function About() {
  return (
    <>
      <SeoHead title={TITLE} description={DESCRIPTION} path="/about" websiteSchema />
      <StaticPage eyebrow="about" title="What is Kamiko?">
        <p>
          Kamiko is an interactive 3D AI VTuber: a live avatar you can talk to by chat or voice,
          right in your browser, at <a href="https://kamiko.fun">kamiko.fun</a>. There is nothing
          to install and nothing to sign up for — open the page and she is already on stage.
        </p>
        <p>
          She reacts to what you say, to a tap-to-wake clicker game running in the same screen, and
          to live market signals from her paired token, $KAMIKO (a Solana token tracked against
          NVDAx on a Raydium LaunchLab bonding curve). None of that requires a wallet to watch —
          holding $KAMIKO is optional, and the avatar, chat, and game work the same with or without
          it.
        </p>
        <h2>Built on Amica</h2>
        <p>
          Kamiko is built on top of{' '}
          <a href="https://github.com/semperai/amica" target="_blank" rel="noopener noreferrer">
            Amica
          </a>
          , an open-source 3D AI avatar project (MIT license) by Semper AI / pixiv. The avatar
          rendering, VRM support, and chat pipeline trace back to that project; Kamiko's own layer on
          top is her persona, the market-reaction behavior, the tap-to-wake game, and the $KAMIKO
          integration.
        </p>
        <h2>Who she's for</h2>
        <p>
          People who like AI VTubers and AI companions, and people following $KAMIKO who want to
          check in on the character tied to the token. If you are evaluating $KAMIKO specifically,
          read the <a href="/token">token page</a> before anything else — it covers what the token
          is, how to verify the contract, and the risks.
        </p>
      </StaticPage>
    </>
  );
}
