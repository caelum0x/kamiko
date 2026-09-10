/**
 * emotes.ts — Kamiko's emote vocabulary, as DATA.
 *
 * WHY THIS EXISTS. The stage could hold fourteen *moods* on her face (emotionMood.ts drives the
 * idle from the same tag) and it could play a `.vrma` clip from exactly two callers — amicaLife's
 * random idle event and the dev-only SSE endpoint. What it could not do is the thing a VTuber
 * audience actually asks for: a NAMED, deliberate gesture on demand. "Do the peace sign." "Bleh."
 * There was no vocabulary, no trigger and no UI, so she reacted to everything with a face and a
 * sway and nothing else.
 *
 * An emote here is three things at once, and all three are optional-by-degree so a half-supported
 * model still does something rather than nothing:
 *
 *   - `face`   — VRM expression weights held together for `holdSeconds`. Note "together": the old
 *                `playEmotion` held exactly ONE expression at full weight, which cannot spell a
 *                wink (one eyelid + a half smile) or a bleh (one eyelid + an open mouth) at all.
 *   - `gesture`— a WINDOW into one of the bundled `.vrma` clips (see GestureClip on why a window
 *                and not the whole file).
 *   - `mood`   — the emotion tag the BODY idles in while the emote plays, so the sway matches.
 *
 * WHY THE FACE KEYS LOOK LIKE THIS. `public/vrm/npc.vrm` is a VRM 0.x export whose blend-shape
 * groups three-vrm renames on import (a→aa, i→ih, u→ou, e→ee, o→oh, joy→happy, fun→relaxed,
 * sorrow→sad, blink_l→blinkLeft, blink_r→blinkRight; groups with no preset keep their own name,
 * which is where `Surprised` and `Extra` come from). Those fifteen names are the entire palette
 * this model has — there is NO tongue morph on a VRoid export, so the tongue-out emote is spelled
 * the way the model can spell it: one eye shut, the mouth open, a smile under it. `resolveFace`
 * below is what keeps that honest on any OTHER model: a weight for an expression the loaded VRM
 * does not have is dropped, not written.
 */

/** The emotes the product ships. Ordering is the order the on-stage bar renders them in. */
export const EMOTE_IDS = [
  'peace',
  'bleh',
  'wink',
  'stonks',
  'rekt',
  'hype',
  'wave',
  'shy',
  'spin',
  'pose',
] as const;

export type EmoteId = (typeof EMOTE_IDS)[number];

/**
 * A WINDOW into a bundled `.vrma`, in seconds of the source clip.
 *
 * The bundled clips are 7–27 seconds long and mostly dead air: `peaceSign.vrma` spends 0.0–0.5s
 * standing still, forms the pose by 1.2s, HOLDS it for eight and a half seconds, then puts the arm
 * down. Played whole (which is all `playAnimation` could do) a peace sign locks the avatar out of
 * her idle for eleven seconds and reads as a freeze, not a gesture. Every window below was measured
 * off the clip's own humanoid data — forward kinematics on the right hand relative to the head —
 * rather than guessed, so `start` is where the limb leaves rest and `end` is a beat after the pose
 * has landed. The release is ours (a cross-fade back to the idle), which is why `end` never has to
 * reach the clip's own return-to-rest.
 */
export interface GestureClip {
  /** Filename under `public/animations/`. */
  file: string;
  /** Seconds into the source clip where the limb starts to move. */
  start: number;
  /** Seconds into the source clip where our slice ends. */
  end: number;
}

export interface Emote {
  id: EmoteId;
  /** What the button says (and the aria-label reads). */
  label: string;
  /** One glyph for the on-stage bar. Text, not an image — it has to survive at 390px. */
  glyph: string;
  /** VRM expression weights, held together for `holdSeconds`. */
  face: Readonly<Record<string, number>>;
  /** The body half, when there is one. */
  gesture?: GestureClip;
  /** Seconds the face is held before it releases back to whatever emotion she was wearing. */
  holdSeconds: number;
  /** The emotion tag the idle runs in meanwhile (emotionMood.ts vocabulary). */
  mood: string;
}

const def = (e: Emote): Emote => Object.freeze({ ...e, face: Object.freeze({ ...e.face }) });

export const EMOTES: Readonly<Record<EmoteId, Emote>> = Object.freeze({
  /*
   * THE ONE THAT WAS ASKED FOR: two fingers beside the eye. `peaceSign.vrma` puts her right hand
   * 0.22m from the head centre and 0.10m below it — beside the cheek, at eye height — and holds it
   * there. Measured, not assumed. `happy` is VRM0 `Joy`, the closed-eye smile that goes with it.
   */
  peace: def({
    id: 'peace',
    label: 'peace sign',
    glyph: '✌️',
    face: { happy: 1 },
    gesture: { file: 'peaceSign.vrma', start: 0.35, end: 3.4 },
    holdSeconds: 3.2,
    mood: 'happy',
  }),

  /*
   * THE OTHER ONE THAT WAS ASKED FOR: てへぺろ — tongue out.
   *
   * BE HONEST ABOUT WHAT THIS IS. VRoid exports carry no tongue morph (npc.vrm's fifty-six face
   * targets are brows, eyes, mouth shapes and teeth — there is no tongue among them), so a
   * literal stuck-out tongue is not something this model CAN do, and faking it with a mouth shape
   * that happens to show teeth would be worse than the honest version. This is the honest version:
   * one eye squeezed shut, the mouth open, the `relaxed` smile under it — the same face the pose is
   * drawn from. Swap in a `tongueOut` weight here the day the authored Kamiko VRM ships one; the
   * player, the bar and the tag path need no change.
   */
  bleh: def({
    id: 'bleh',
    label: 'bleh (tongue out)',
    glyph: '😝',
    face: { blinkLeft: 1, relaxed: 0.85, aa: 0.8 },
    holdSeconds: 2.4,
    mood: 'happy',
  }),

  wink: def({
    id: 'wink',
    label: 'wink',
    glyph: '😉',
    face: { blinkRight: 1, relaxed: 0.55 },
    holdSeconds: 1.5,
    mood: 'happy',
  }),

  /*
   * STONKS. `shoot.vrma` is the only bundled clip that puts a hand ABOVE the head (right hand
   * +0.09m over head centre, 2.2s→4.0s) — an arm thrown up, which is the number-go-up pose. This
   * is also the emote the live tape fires on its own; see marketEmote.ts.
   */
  stonks: def({
    id: 'stonks',
    label: 'stonks (number go up)',
    glyph: '📈',
    face: { Surprised: 0.65, happy: 0.55 },
    gesture: { file: 'shoot.vrma', start: 1.9, end: 4.7 },
    holdSeconds: 3.4,
    mood: 'victory',
  }),

  /*
   * The other side of the tape. Deliberately FACE-ONLY: none of the bundled clips is a slump, and
   * a cheerful stock gesture under a devastated face is the kind of mismatch an audience reads as
   * broken. A sad face and a slowed, shrunken idle (emotionMood 'sad') is the whole emote.
   */
  rekt: def({
    id: 'rekt',
    label: 'rekt (number go down)',
    glyph: '📉',
    face: { sad: 1, ou: 0.25 },
    holdSeconds: 3.4,
    mood: 'sad',
  }),

  /*
   * DELIBERATELY NOT `Extra`. npc.vrm's extra eye shape (VRoid `Fcl_EYE_Extra`, morph #25) was in
   * this recipe first, on the assumption it is the usual "＞＜" squeeze. Rendered, it is a pair of
   * heavy black slashes laid over her eyes — an assumption worth an actual look, and this is why
   * the registry only ever names shapes that have been seen on the shipped model.
   */
  hype: def({
    id: 'hype',
    label: 'hype (dance)',
    glyph: '🕺',
    face: { happy: 0.9, aa: 0.55 },
    gesture: { file: 'dance.vrma', start: 0, end: 7.5 },
    holdSeconds: 7.5,
    mood: 'victory',
  }),

  wave: def({
    id: 'wave',
    label: 'wave hello',
    glyph: '👋',
    face: { happy: 0.8 },
    gesture: { file: 'greeting.vrma', start: 1.7, end: 4.6 },
    holdSeconds: 3.0,
    mood: 'happy',
  }),

  /*
   * Half-lidded rather than merely smiling: with only `relaxed` + a little `sad` this was so close
   * to her resting face that pressing it looked like nothing had happened. `blink` at a partial
   * weight is what lowers the lids — the emote owns the eyelids for its duration, so the auto-blink
   * steps aside (ExpressionController.playEmoteFace) instead of fighting it.
   */
  shy: def({
    id: 'shy',
    label: 'shy',
    glyph: '😳',
    face: { relaxed: 0.65, sad: 0.5, blink: 0.45 },
    holdSeconds: 2.6,
    mood: 'shy',
  }),

  spin: def({
    id: 'spin',
    label: 'spin',
    glyph: '🌀',
    face: { happy: 0.6 },
    gesture: { file: 'spin.vrma', start: 0.9, end: 5.0 },
    holdSeconds: 4.3,
    mood: 'happy',
  }),

  pose: def({
    id: 'pose',
    label: 'pose',
    glyph: '💃',
    face: { relaxed: 0.5 },
    gesture: { file: 'modelPose.vrma', start: 0.2, end: 4.0 },
    holdSeconds: 4.0,
    mood: 'serious',
  }),
});

/** The emotes in bar order. */
export const EMOTE_LIST: readonly Emote[] = Object.freeze(EMOTE_IDS.map((id) => EMOTES[id]));

/** PURE. Is `tag` the name of an emote? Case-insensitive, so `[Peace]` and `[peace]` both count. */
export function isEmoteId(tag: unknown): tag is EmoteId {
  return typeof tag === 'string' && (EMOTE_IDS as readonly string[]).includes(tag.trim().toLowerCase());
}

/** PURE. The emote for a tag, or null. Never throws on junk — this runs on model output. */
export function emoteFor(tag: unknown): Emote | null {
  return isEmoteId(tag) ? EMOTES[tag.trim().toLowerCase() as EmoteId] : null;
}

const clamp01 = (v: number): number => (Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0);

/**
 * PURE. The face weights to actually write, given the expressions the loaded VRM really has.
 *
 * The stage lets a visitor swap the model (`/share`, the character-model settings page, three
 * bundled AvatarSamples), and expression names are not portable: a VRM 1.0 model has no `Surprised`
 * or `Extra`, and a minimal one may have no `blinkLeft` either. `VRMExpressionManager.setValue` on a
 * name it does not know is a silent no-op today, but the emote is not — half a bleh is one closed
 * eye and nothing else. So: unknown names are dropped HERE, weights are clamped to [0,1] (they feed
 * a mesh), and an emote left with nothing to say returns an empty object, which is the caller's
 * signal to fall back to the plain mood.
 *
 * `available` empty means "we could not read the model's expression list" — trust the registry
 * rather than blank the face, since setValue tolerates a miss.
 */
export function resolveFace(
  emote: Emote,
  available?: ReadonlySet<string> | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, weight] of Object.entries(emote.face)) {
    if (available && available.size > 0 && !available.has(name)) continue;
    const w = clamp01(weight);
    if (w > 0) out[name] = w;
  }
  return out;
}
