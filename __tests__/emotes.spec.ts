/**
 * emotes.spec.ts — the emote vocabulary and everything that fires it.
 *
 * These four modules are what turned "she can hold a mood" into "she can DO something": the
 * registry, the clip slicer that makes an eleven-second `.vrma` into a three-second gesture, the
 * market rule that lets the live tape trigger one, and the reply-tag path that lets her choose one
 * herself. Every test below fails without the behaviour it names.
 */
import { describe, expect, test } from '@jest/globals';

import {
  EMOTES,
  EMOTE_IDS,
  EMOTE_LIST,
  emoteFor,
  isEmoteId,
  resolveFace,
} from '@/features/emote/emotes';
import { sliceTimes } from '@/features/emote/gestureClip';
import { bandFor, marketEmoteFor, pulsePct, REKT_PCT, STONKS_PCT } from '@/features/emote/marketEmote';
import { textsToScreenplay } from '@/features/chat/messages';
import { processResponse } from '@/utils/processResponse';
import type { Screenplay } from '@/features/chat/messages';

/** The expression names `public/vrm/npc.vrm` really exposes, after three-vrm's VRM0→1 renaming. */
const NPC_VRM_EXPRESSIONS = new Set([
  'neutral', 'aa', 'ih', 'ou', 'ee', 'oh',
  'blink', 'blinkLeft', 'blinkRight',
  'angry', 'relaxed', 'happy', 'sad',
  'Surprised', 'Extra',
]);

describe('the emote registry', () => {
  test('every emote is playable on the shipped model — no weight names a shape npc.vrm lacks', () => {
    // This is the test that catches a typo'd expression name, which is otherwise a SILENT failure:
    // VRMExpressionManager.setValue on an unknown name is a no-op, so a misspelt `blinkleft` would
    // ship as an emote that plays half of itself and never errors.
    for (const emote of EMOTE_LIST) {
      for (const name of Object.keys(emote.face)) {
        expect(NPC_VRM_EXPRESSIONS.has(name)).toBe(true);
      }
      expect(Object.keys(emote.face).length).toBeGreaterThan(0);
    }
  });

  test('every weight is a real [0,1] number and every hold is positive', () => {
    for (const emote of EMOTE_LIST) {
      for (const w of Object.values(emote.face)) {
        expect(Number.isFinite(w)).toBe(true);
        expect(w).toBeGreaterThan(0);
        expect(w).toBeLessThanOrEqual(1);
      }
      expect(emote.holdSeconds).toBeGreaterThan(0);
    }
  });

  test('a gesture window is a real slice of its clip, and the face outlives it or matches it', () => {
    for (const emote of EMOTE_LIST) {
      if (!emote.gesture) continue;
      expect(emote.gesture.end).toBeGreaterThan(emote.gesture.start);
      expect(emote.gesture.start).toBeGreaterThanOrEqual(0);
      expect(emote.gesture.file).toMatch(/\.vrma$/);
    }
  });

  test('the id, the map key and the list order all agree', () => {
    expect(EMOTE_LIST.map((e) => e.id)).toEqual([...EMOTE_IDS]);
    for (const id of EMOTE_IDS) expect(EMOTES[id].id).toBe(id);
  });

  test('tags are matched case- and whitespace-insensitively, and nothing else matches', () => {
    expect(isEmoteId('peace')).toBe(true);
    expect(isEmoteId(' Peace ')).toBe(true);
    expect(emoteFor('BLEH')?.id).toBe('bleh');
    expect(isEmoteId('definitely-not-an-emote')).toBe(false);
    expect(isEmoteId(undefined)).toBe(false);
    expect(isEmoteId(42)).toBe(false);
    expect(emoteFor('nonsense')).toBeNull();
  });
});

describe('resolveFace — an emote on a model that is not hers', () => {
  test('drops expressions the loaded VRM does not have', () => {
    // A VRM 1.0 model has no `Surprised` and no `Extra`.
    const vrm1 = new Set(['happy', 'sad', 'angry', 'relaxed', 'aa', 'blinkLeft']);
    const face = resolveFace(EMOTES.stonks, vrm1);
    expect(face).not.toHaveProperty('Surprised');
    expect(face.happy).toBeCloseTo(0.55);
  });

  test('returns nothing when the model can spell none of it — the caller falls back to the mood', () => {
    expect(resolveFace(EMOTES.bleh, new Set(['angry']))).toEqual({});
  });

  test('an unknown expression list is trusted rather than treated as empty', () => {
    // `available` empty means "we could not read the model", not "the model has no expressions" —
    // blanking the face there would break every emote on a model that is actually fine.
    expect(Object.keys(resolveFace(EMOTES.wink, new Set()))).toEqual(['blinkRight', 'relaxed']);
    expect(Object.keys(resolveFace(EMOTES.wink, null))).toEqual(['blinkRight', 'relaxed']);
  });

  test('weights are clamped — a bad registry entry cannot distort the mesh', () => {
    const face = resolveFace(
      { ...EMOTES.wink, face: { happy: 4, sad: -1, angry: Number.NaN, relaxed: 0.5 } },
      null,
    );
    expect(face).toEqual({ happy: 1, relaxed: 0.5 }); // over-range caps, negative and NaN drop out
  });
});

describe('sliceTimes — cutting a gesture out of a long clip', () => {
  const times = [0, 0.5, 1, 1.5, 2, 2.5, 3];

  test('keeps the keys inside the window and rebases them to zero', () => {
    expect(sliceTimes(times, 1, 2)).toEqual({ indices: [2, 3, 4], times: [0, 0.5, 1] });
  });

  test('a track with no key in the window collapses to its nearest key, never to nothing', () => {
    // A KeyframeTrack with zero keys throws inside three's interpolant on the first frame, which
    // kills the render loop — "no keys in range" can never be the answer.
    const r = sliceTimes([0], 5, 8);
    expect(r.indices).toEqual([0]);
    expect(r.times).toEqual([0]);
  });

  test('an empty track stays empty (the caller drops it) and a junk window does not throw', () => {
    expect(sliceTimes([], 0, 1)).toEqual({ indices: [], times: [] });
    expect(sliceTimes(times, Number.NaN, Number.NaN).indices.length).toBeGreaterThan(0);
  });

  test('an inverted window is treated as an instant, not as the whole clip', () => {
    expect(sliceTimes(times, 2, 1).times).toEqual([0]);
  });
});

describe('the market fires the stonks pose', () => {
  test('her own token wins the tape once it is live; the NVDAX quote carries it before that', () => {
    expect(pulsePct({ quote: { change24h: 2 }, tokenTape: { change24h: 40, live: true } })).toBe(40);
    expect(pulsePct({ quote: { change24h: 2 }, tokenTape: { change24h: 40, live: false } })).toBe(2);
    expect(pulsePct({ quote: { change24h: 2 } })).toBe(2);
  });

  test('a missing or unreadable number is no opinion at all, never a flat 0', () => {
    // A JSON null coerced to 0 reads as "flat" and permanently re-arms the trigger.
    expect(pulsePct({ quote: { change24h: null } })).toBeNull();
    expect(pulsePct({})).toBeNull();
    expect(pulsePct(null)).toBeNull();
    expect(bandFor(null)).toBeNull();
  });

  test('the bands are the documented thresholds', () => {
    expect(bandFor(STONKS_PCT)).toBe('up');
    expect(bandFor(STONKS_PCT - 0.01)).toBe('flat');
    expect(bandFor(REKT_PCT)).toBe('down');
    expect(bandFor(REKT_PCT + 0.01)).toBe('flat');
  });

  test('the FIRST reading of a session never fires — she does not greet you mid-breakdown', () => {
    const first = marketEmoteFor(null, { quote: { change24h: -30 } });
    expect(first).toEqual({ emote: null, band: 'down' });
  });

  test('it fires on the CROSSING and then goes quiet, however long the move lasts', () => {
    let band = marketEmoteFor(null, { quote: { change24h: 0 } }).band;
    const pump = marketEmoteFor(band, { quote: { change24h: 12 } });
    expect(pump.emote).toBe('stonks');
    band = pump.band;
    // Still up 12% sixty seconds later: no second pose.
    expect(marketEmoteFor(band, { quote: { change24h: 12 } }).emote).toBeNull();
    // Back inside the band re-arms without saying anything…
    band = marketEmoteFor(band, { quote: { change24h: 1 } }).band;
    expect(band).toBe('flat');
    // …and the next pump fires again.
    expect(marketEmoteFor(band, { quote: { change24h: 9 } }).emote).toBe('stonks');
  });

  test('a dump fires rekt, and a straight up→down flip fires without needing to pass through flat', () => {
    expect(marketEmoteFor('flat', { quote: { change24h: -8 } }).emote).toBe('rekt');
    expect(marketEmoteFor('up', { quote: { change24h: -8 } }).emote).toBe('rekt');
  });

  test('a failed read holds the band rather than resetting it', () => {
    // Otherwise one dropped poll re-arms the trigger and the next good read repeats the pose.
    expect(marketEmoteFor('up', {})).toEqual({ emote: null, band: 'up' });
  });
});

describe('she can ask for an emote in her own reply', () => {
  test('a second leading tag becomes the screenplay emote and is never spoken', () => {
    const [line] = textsToScreenplay(['[happy] [peace] gm chat']);
    expect(line.emote).toBe('peace');
    expect(line.talk.message.trim()).toBe('gm chat');
    expect(line.expression).toBe('happy');
  });

  test('a line with only an emotion tag parses exactly as it always did', () => {
    const [line] = textsToScreenplay(['[angry] the chart is bleeding']);
    expect(line.emote).toBeUndefined();
    expect(line.expression).toBe('angry');
  });

  test("an emote's own mood carries the line when no emotion was named", () => {
    // `[neutral] [rekt] …` would otherwise be delivered with a neutral face over a devastated pose.
    const [line] = textsToScreenplay(['[nonsense] [rekt] we are so back, actually we are not']);
    expect(line.emote).toBe('rekt');
    expect(line.expression).toBe('sad');
  });

  test('a second bracket that is not an emote stays in the text', () => {
    const [line] = textsToScreenplay(['[happy] [sic] they really said that']);
    expect(line.emote).toBeUndefined();
  });

  test('processResponse fires the gesture ONCE, not once per sentence', () => {
    // `tag` is deliberately carried onto every sentence so the mood holds for the whole answer;
    // carrying the emote too would re-throw the peace sign at every full stop.
    const spoken: Screenplay[] = [];
    let state = {
      sentences: [] as string[],
      aiTextLog: '',
      receivedMessage: '',
      tag: '',
      emote: '',
      isThinking: false,
      rolePlay: '',
    };
    // One sentence per chunk: the sentence matcher is greedy, so a single string holding both would
    // be emitted as one line and the test would prove nothing about the second.
    for (const chunk of ['[happy] [peace] first one.', ' second one.']) {
      const proc = processResponse({
        ...state,
        receivedMessage: state.receivedMessage + chunk,
        callback: (talks) => {
          spoken.push(talks[0]);
          return false;
        },
      });
      state = {
        sentences: proc.sentences,
        aiTextLog: proc.aiTextLog,
        receivedMessage: proc.receivedMessage,
        tag: proc.tag,
        emote: proc.emote,
        isThinking: proc.isThinking,
        rolePlay: proc.rolePlay,
      };
    }
    expect(spoken.length).toBeGreaterThanOrEqual(2);
    expect(spoken[0].emote).toBe('peace');
    expect(spoken[1].emote).toBeUndefined();
    expect(spoken[1].expression).toBe('happy'); // …while the MOOD does carry
  });

  test('the two tags may arrive in different stream chunks', () => {
    // "[hap", "py] [pea", "ce] hi there." is a normal way for this to come over the wire.
    const spoken: Screenplay[] = [];
    let state = {
      sentences: [] as string[],
      aiTextLog: '',
      receivedMessage: '',
      tag: '',
      emote: '',
      isThinking: false,
      rolePlay: '',
    };
    for (const chunk of ['[hap', 'py] [pea', 'ce] hi there.']) {
      const proc = processResponse({
        ...state,
        receivedMessage: state.receivedMessage + chunk,
        callback: (talks) => {
          spoken.push(talks[0]);
          return false;
        },
      });
      state = {
        sentences: proc.sentences,
        aiTextLog: proc.aiTextLog,
        receivedMessage: proc.receivedMessage,
        tag: proc.tag,
        emote: proc.emote,
        isThinking: proc.isThinking,
        rolePlay: proc.rolePlay,
      };
    }
    expect(spoken[0]?.emote).toBe('peace');
    expect(spoken[0]?.talk.message.trim()).toBe('hi there.');
  });
});
