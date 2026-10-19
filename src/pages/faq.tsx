import { SeoHead } from '@/components/seoHead';
import { StaticPage } from '@/components/staticPage';

const TITLE = 'Kamiko FAQ';
const DESCRIPTION =
  'Frequently asked questions about Kamiko, the live 3D AI VTuber, and the $KAMIKO token paired with NVDAx.';

const FAQ = [
  {
    question: 'What is Kamiko?',
    answer:
      'Kamiko is an interactive 3D AI VTuber you can talk to in your browser, with chat, voice, and a tap-to-wake game.',
  },
  {
    question: 'Do I need a wallet or an account to use Kamiko?',
    answer:
      'No. Kamiko runs entirely in your browser — just open kamiko.fun and start talking. Nothing is required to explore her.',
  },
  {
    question: 'What is $KAMIKO?',
    answer:
      'A Solana token tracked against NVDAx on a Raydium LaunchLab bonding curve. Kamiko can react to its price moves in character, but holding it is never required to use the avatar, chat, or game.',
  },
  {
    question: 'Is Kamiko built from scratch?',
    answer:
      "No — Kamiko is built on Amica (github.com/semperai/amica), an open-source 3D AI avatar project under the MIT license, with its own persona, market-reaction behavior, tap-to-wake game and $KAMIKO integration layered on top.",
  },
  {
    question: 'Where do I check the real $KAMIKO contract address before buying?',
    answer:
      'On the token page (/token) and in the tap-to-wake panel on the live stage — never from a link in a reply, comment, or DM claiming to be Kamiko.',
  },
] as const;

export default function Faq() {
  return (
    <>
      <SeoHead title={TITLE} description={DESCRIPTION} path="/faq" websiteSchema faq={FAQ} />
      <StaticPage eyebrow="faq" title="Frequently asked questions">
        <dl className="space-y-5">
          {FAQ.map(({ question, answer }) => (
            <div key={question}>
              <dt className="font-semibold text-white">{question}</dt>
              <dd className="mt-1 text-white/85">{answer}</dd>
            </div>
          ))}
        </dl>
      </StaticPage>
    </>
  );
}
