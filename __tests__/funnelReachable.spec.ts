/**
 * funnelReachable.spec.ts — every funnel surface is reachable from the front door.
 *
 * WHY THIS FILE EXISTS, and it is a regression I shipped rather than a hypothetical.
 *
 * `/` is the URL a visitor actually lands on. `/game` (retention), `/holder` (tips and perks — the
 * revenue surface) and `/trust` (the mint check somebody does BEFORE buying) were once
 * direct-link-only orphans: they linked back to `/` and nothing linked forward. index.tsx carries a
 * comment about that, and about the trust page being the one that cost the most, because a person
 * who lands on `/` and wants to verify the contract had no path to the page that answers it.
 *
 * Three menu buttons fixed it. Then the tap panel moved onto the avatar screen and the `/game`
 * button became the panel's toggle — so the leaderboard, quests, the CTA, the wallet handshake and
 * the streak saver went straight back to being unreachable, and the only mention of `/game` left in
 * index.tsx was in prose explaining why. Nothing failed. The panel now carries the way forward, and
 * this file is what makes the next version of that mistake a red build instead of a quiet one.
 *
 * It is a SOURCE SCAN, not a render: index.tsx pulls in the VRM viewer, i18n and the whole settings
 * tree, and a test that mounts it would be testing three.js. What matters here is only whether a
 * path forward exists in the code at all, which is exactly what went missing.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APP = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(APP, rel), 'utf8');

/** Comments explain why a route matters; they are not a way to reach it. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Strip string literals as well as comments, for the same reason: PROSE IS NOT A CHECK.
 *
 * Found by this file's own negative control. The unset-API assertion looks for `configured`, and
 * the copy it guarantees says "…no funnel API configured (NEXT_PUBLIC_NPC_API)" — so deleting the
 * branch and keeping the sentence passed. A gate a user-facing string can satisfy tests spelling.
 *
 * IT DOES NOT TOUCH JSX TEXT, and that is a correction rather than an omission. A rule that
 * stripped `>…<` spans looked right and was DESTRUCTIVE: with no newline bound it matched from the
 * `>` of an arrow function to the `<` of a later generic, deleting the real code in between —
 * `useEffect(() => () => setMoodRef…)` became `useEffect(() => () =><HTMLButtonElement>) => {`.
 * A scanner that corrupts what it scans can report anything. The prose problem is solved on the
 * assertion side instead: the checks below look for CODE-SHAPED uses of an identifier, which no
 * sentence produces.
 */
/**
 * Use THIS when the assertion is about the TEXT OF A LITERAL — a specific string the code passes.
 *
 * Named rather than left as a bare `withoutComments` call because the mistake below has been made
 * three times in this file: reaching for `codeOnly` (which blanks every literal) and then matching
 * on a literal, producing a regex that can never fire and a check that passes on sabotaged code.
 * The two helpers answer different questions and the call site should say which one it is asking.
 */
const sourceKeepingLiterals = withoutComments;

/** Use THIS when the assertion is about an IDENTIFIER being used in code, not about any text. */
function codeOnly(source: string): string {
  return withoutComments(source)
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""');
}

/**
 * Every funnel route, and what a visitor loses when nothing on `/` leads to it. The `why` is in the
 * failure message on purpose: "route unreachable" is a fact, and the reason is what decides whether
 * somebody fixes it now or after the launch.
 */
const FUNNEL: ReadonlyArray<{ route: string; why: string }> = [
  // `/game` is deliberately ABSENT from this list now. Its content is rendered on `/` itself (see
  // "the clicker dashboard is ON the page" below), so requiring a link to it would be requiring the
  // navigation the panel exists to remove. The route still works for a direct link; nothing on the
  // front page sends you there.
  { route: '/holder', why: 'the holder dashboard: tier, perks and SOL tips — the revenue surface' },
  { route: '/trust', why: 'the mint verification a person does BEFORE they buy; unreachable, they buy on trust or not at all' },
];

describe('the front door leads to every funnel surface', () => {
  const index = withoutComments(read('src/pages/index.tsx'));
  const panel = withoutComments(read('src/components/tapToWake.tsx'));
  // The panel took over the `/game` button, so a path from inside it counts as a path forward.
  const frontDoor = `${index}\n${panel}`;

  for (const { route, why } of FUNNEL) {
    it(`${route} is reachable from / — ${why}`, () => {
      // `router.push("/x")` is the form index.tsx uses deliberately: MenuButton's `href` is
      // window.open, which takes a raw URL and does NOT apply next.config.js's basePath, so on a
      // BASE_PATH deployment every one of those would open a 404.
      const pushed = new RegExp(`router\\.push\\(\\s*["'\`]${route}["'\`]`).test(frontDoor);
      const routed = new RegExp(`["'\`]${route}["'\`]`).test(frontDoor);
      // The reason is folded into the compared VALUE because jest's expect takes no message
      // argument: on a failure the diff prints the sentence, which is the part that decides whether
      // somebody fixes this now or after the launch.
      const verdict = pushed || routed
        ? 'reachable'
        : `UNREACHABLE — nothing on / leads to ${route}. It is ${why}, and a surface a visitor cannot reach is a surface that does not exist.`;
      expect(verdict).toBe('reachable');
    });
  }

  it('the clicker dashboard is ON the page, not one navigation away', () => {
    /*
     * THE RULE CHANGED, DELIBERATELY, AND THIS IS THE STRONGER FORM OF IT.
     *
     * The panel used to end in a button that pushed to /game. That is the problem the panel was
     * built to solve with an extra click in front of it: the avatar is the product, and leaving her
     * to find out how you are doing is the thing worth not doing. So the leaderboard, the quest
     * board and the verified-contract CTA render over the stage instead.
     *
     * What is asserted is that they are actually THERE — a panel that dropped the link without
     * gaining the content would pass a weaker test and be a downgrade.
     */
    expect(panel).toMatch(/\buseNpcBoard\s*\(/);
    // jest's expect takes no message argument, so the missing piece is named in the value.
    const missing = ['rows', 'quests', 'caText', 'copyCa'].filter((piece) => !panel.includes(piece));
    expect(missing.length ? `the panel does not render: ${missing.join(', ')}` : 'renders all of it').toBe('renders all of it');
    // And it must not navigate: no router, no href, no push.
    expect(panel).not.toMatch(/router\.push/);
    expect(panel).not.toMatch(/openDashboard/);
  });

  it('both surfaces publish the contract on the SAME rule', () => {
    /*
     * The rule is "links whenever the verifier published a contract" — which includes `caution`,
     * where cta.ts returns links and says "the links below are the real contract — read the trust
     * page before you buy". Gating on `state === 'live'` looks stricter and is more dangerous: it
     * withholds the real address from exactly the person who is about to go searching for it, and
     * searching is how somebody lands on an impostor.
     *
     * Neither surface may quietly become the stricter one, so neither may test the state to decide
     * whether to LINK.
     */
    for (const file of ['src/pages/game.tsx', 'src/components/tapToWake.tsx']) {
      const src = sourceKeepingLiterals(read(file));
      // A bounded multi-line window, not `[^\n]*`: the gate and the link it guards sit on different
      // lines in JSX, so a single-line pattern could never see them together — which is how the
      // first version of this check passed on deliberately sabotaged code.
      const gatesLinkOnLive = /state === 'live'[\s\S]{0,300}?(buy|chart)/.test(src);
      expect(gatesLinkOnLive ? `${file} gates the buy/chart links on state === 'live'` : 'links on cta presence').toBe('links on cta presence');
    }
  });

  it('the dashboard reads are SHARED with /game, not a second copy', () => {
    // The refusals in useNpcBoard are the honest-money rules — a leaderboard that shows real
    // players or nothing, a CTA written by the verifier or not at all. Two copies of those drift,
    // and the copy that drifts is the one nobody is looking at.
    expect(codeOnly(read('src/pages/game.tsx'))).toMatch(/\buseNpcBoard\s*\(/);
  });

  it('scans a real front door, so a rename cannot make this pass by finding nothing', () => {
    // The anchor. Without it, moving or renaming index.tsx would leave every assertion above
    // matching an empty string — the way the previous client scan in this repo rotted before it
    // was deleted.
    expect(index.length).toBeGreaterThan(2000);
    expect(index).toMatch(/MenuButton/);
    expect(panel).toMatch(/useWakeTaps/);
  });
});

/**
 * THE SECOND WAY A SURFACE STOPS EXISTING: it renders perfectly and talks to nothing.
 *
 * `NEXT_PUBLIC_NPC_API` is inlined at BUILD time, so a build shipped without it produces pages that
 * animate, count, fill a meter and change an avatar's face while npc-api has never heard from them.
 * /holder and /trust have always said so. Both tap surfaces did not: they counted into localStorage
 * and showed '…' for the global, which is exactly what a working page shows while it is loading.
 *
 * The rule is therefore: a page that reads `API` must also render something when it is unset.
 */
describe('a surface that talks to nothing says so', () => {
  const SURFACES = [
    { file: 'src/pages/game.tsx', what: 'the clicker dashboard' },
    { file: 'src/pages/holder.tsx', what: 'the holder dashboard — tier, perks and tips' },
    { file: 'src/pages/trust.tsx', what: 'the mint verification' },
    { file: 'src/components/tapToWake.tsx', what: 'the tap panel on the avatar screen' },
  ] as const;

  for (const { file, what } of SURFACES) {
    it(`${file} reports an unset NEXT_PUBLIC_NPC_API — ${what}`, () => {
      const src = codeOnly(read(file));
      // Either it reads `API` directly and branches on it, or it takes `configured` from the engine
      // (useWakeTaps), which is `Boolean(API)`. Both are a real check; neither is a comment.
      // Code-shaped uses only: negated, destructured, or in a conditional. A sentence containing
      // the word "configured" produces none of these.
      const branches =
        /!\s*API\b/.test(src) ||
        /!\s*configured\b/.test(src) ||
        /[{,]\s*configured\s*[,}]/.test(src) ||
        /\bconfigured\s*[?&|]/.test(src);
      const verdict = branches
        ? 'reports it'
        : `SILENT — ${file} (${what}) reads the funnel API but renders nothing when NEXT_PUBLIC_NPC_API is unset. The page still animates, so a visitor cannot tell it is talking to nothing.`;
      expect(verdict).toBe('reports it');
    });
  }

  it('the engine is what both tap surfaces ask, so there is one answer', () => {
    // Two independent Boolean(API) checks are two things to forget to update.
    expect(read('src/npc/useWakeTaps.ts')).toMatch(/configured:\s*Boolean\(API\)/);
  });
});

/**
 * THE VERB HAS TO BE TRUE.
 *
 * The clicker is called "tap to wake her". Her wakefulness is not the panel's meter — it is
 * chat.lastAwake and amicaLife.isSleep, and amicaLife is enabled by default (config.ts:
 * amica_life_enabled defaults to 'true'), puts her to `Sleep` on idle and pauses itself. Nothing
 * outside amicaLife has ever called wakeFromSleep(), so a player could fill the bar to 100% while
 * she stayed asleep in the system that decides whether she idles, animates and speaks on her own,
 * with the panel painting `happy` over a sleeping face and the two states never reconciling.
 *
 * These assert the wiring exists at all. They are source scans for the same reason the rest of this
 * file is: mounting index.tsx means mounting three.js.
 */
describe('tapping actually wakes her', () => {
  const index = codeOnly(read('src/pages/index.tsx'));
  const panel = codeOnly(read('src/components/tapToWake.tsx'));

  it('every tap tells chat she is awake', () => {
    // chat.lastAwake is what isAwake() reads; without this the idle timer never resets and she is
    // "idle" while somebody is actively tapping her.
    expect(panel).toMatch(/onTap/);
    expect(index).toMatch(/updateAwake\(\)/);
  });

  it('a waking mood ends amicaLife sleep, so the face and the state agree', () => {
    expect(index).toMatch(/wakeFromSleep\(\)/);
  });

  it('wakeFromSleep runs BEFORE playEmotion, or the mood is immediately overwritten', () => {
    // wakeFromSleep() writes "Neutral" itself (amicaLife.ts). Called after playEmotion it would
    // undo the mood on every single crossing, which looks exactly like the feature not working.
    const wake = index.indexOf('wakeFromSleep()');
    const play = index.indexOf('playEmotion(mood)');
    expect(wake).toBeGreaterThan(-1);
    expect(play).toBeGreaterThan(-1);
    expect(wake).toBeLessThan(play);
  });

  it('waking her is the FULL sequence, not just clearing the sleep flag', () => {
    // handleSleepEvent pauses the amicaLife loop on the way in, so wakeFromSleep() alone leaves her
    // neither asleep nor running. amicaLife.checkSettingOff is the repo's own canonical answer to
    // "the user came back" — wakeFromSleep, updateAwake, resume — and this must match it.
    for (const call of ['wakeFromSleep()', 'updateAwake()', 'resume()']) {
      expect(index).toContain(call);
    }
  });

  it('closing the panel does NOT wake her', () => {
    // The bug this replaced: the panel reset her to 'neutral' on unmount, and `setMood` is the
    // WAKING path — so opening and closing it without tapping once pulled her out of the sleep the
    // idle timer had put her in.
    expect(panel).not.toMatch(/useEffect\(\s*\(\)\s*=>\s*\(\)\s*=>\s*setMoodRef/);
  });

  it('a tap line is SPOKEN, never written into her conversation memory', () => {
    /*
     * chat.ttsJobs ends in processSpeakJobs, which calls bubbleMessage("assistant", …) for every
     * job. bubbleMessage APPENDS to currentAssistantMessage, that lands in `messageList`, and
     * receiveMessageFromUser splices `messageList` into the prompt as prior context on the next
     * turn. Routing a clicker milestone through that queue therefore teaches the model she said a
     * greeting nobody earned, glued onto her last real reply, on every subsequent turn.
     *
     * The tap path must use fetchAudio + model.speak — the same pair, minus the logging.
     */
    expect(index).toMatch(/fetchAudio\(/);
    expect(index).toMatch(/model\?\.speak\(/);
    expect(index).not.toMatch(/ttsJobs\.enqueue/);
    expect(index).not.toMatch(/bubbleMessage/);
  });

  it('nothing asks for a capitalised "Neutral" — it silently disables her blinking', () => {
    /*
     * expressionController.playEmotion's neutral reset is guarded by `preset == "neutral"`, an
     * exact lowercase comparison, and every path past that guard calls _autoBlink.setEnable(false).
     * amicaLife.wakeFromSleep passed "Neutral", so waking her — which the tap path now does — left
     * her not blinking, which reads as the avatar having frozen.
     */
    // withoutComments, NOT codeOnly: this asserts something about a STRING LITERAL, and codeOnly
    // blanks those out — under it the regex can never match and the check is decorative. The rule
    // learned twice in this file: codeOnly proves an identifier is USED; withoutComments proves
    // something about the text of a literal.
    for (const file of ['src/features/amicaLife/amicaLife.ts', 'src/features/amicaLife/eventHandler.ts', 'src/pages/index.tsx']) {
      expect(sourceKeepingLiterals(read(file))).not.toMatch(/playEmotion\(\s*["'`]Neutral["'`]/);
    }
  });

  it('the panel can wake her but may not put her to sleep', () => {
    // A 'Sleep' mood is a fact about the CLICKER's meter, not about her. Writing it is the mirror
    // of the closing-wakes-her bug: open the panel while she is awake and mid-conversation, the
    // meter starts at zero, and the first mood effect paints her asleep. Whether she is asleep is
    // amicaLife's call, from the idle timer.
    expect(sourceKeepingLiterals(read('src/pages/index.tsx'))).toMatch(/mood === 'Sleep'\)\s*return/);
  });

  it('the panel does not write her face while the chat is speaking', () => {
    // processSpeakJobs sets the expression for the sentence she is delivering. Overwriting it
    // because the meter crossed a band is the panel talking over her.
    expect(index).toMatch(/chatSpeaking/);
  });
});
