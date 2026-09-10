import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";

/**
 * kamikoLook.ts — Kamiko's signature, applied to whatever VRM is loaded.
 *
 * She is defined (packages/character-kit/npc.character.json, brand/BRAND.md) by two beats: she "only
 * half woke up" — the awake eye glows **neon red** (`#ff2b4d`) — and she is white/silver-haired.
 * `npc.character.json` sets `avatar.heterochromia: true`, which until now nothing
 * read: the shipped model is a stock VRoid sample (dark hair, plain eyes). This restyles the loaded
 * model into Kamiko at runtime, so even the placeholder reads as her until an authored VRM is dropped
 * in at public/vrm/npc.vrm.
 *
 * WHAT IT DOES:
 *  - EYES: sets an emissive neon-green glow on the iris material(s). Sclera / highlight / lash / brow
 *    are excluded so only the coloured iris lights up. (On a shared-iris sample both eyes glow; a true
 *    one-asleep/one-glowing split needs the authored model.)
 *  - HAIR: recolours hair material(s) to white/silver. The stock hair colour lives in the base texture,
 *    which a colour multiply cannot lighten, so it clears the base map and drives the colour from the
 *    material factor (with a slightly darker shade for depth on MToon).
 *
 * COSMETIC AND DEFENSIVE: it only ever touches colour/emissive/map fields, is wrapped so it can never
 * throw into model loading, and no-ops on any material that lacks the field it wants.
 */

/** The awake-eye glow — neon red. */
export const KAMIKO_AWAKE_NEON = 0xff2b4d;
/** White/silver hair — bright base, faintly cool. */
export const KAMIKO_HAIR = 0xe9e9f2;
/** The MToon shade tone for hair — a touch darker/cooler so it isn't a flat sheet. */
export const KAMIKO_HAIR_SHADE = 0xb9bccb;
/** A cool techwear multiply for the outfit — shifts stock clothing toward panel-gray, no glow. */
export const KAMIKO_OUTFIT_TINT = 0x9aa0b4;

/** Iris-ish material/mesh names across VRoid / VRM exporters. */
const IRIS_RE = /iris|pupil|hitomi|_eye(_|$|iris)/i;
/** Never light these up — they are the white, the shine, or the frame of the eye, not the colour. */
const EYE_EXCLUDE_RE = /white|sclera|highlight|shadow|lash|line|brow|extra/i;
/** Hair material names. */
const HAIR_RE = /hair/i;
/** Outfit / clothing materials (VRoid names them CLOTH / Onepiece / Tops / Bottoms / …). */
const OUTFIT_RE = /cloth|onepiece|tops|bottoms|jacket|coat|costume|outfit|dress|skirt|shoes|accessory/i;
/** Keep skin, face and body out of the outfit tint. */
const OUTFIT_EXCLUDE_RE = /skin|face|body_00|_eye|_hair|nail/i;

interface LookMaterial {
  name?: string;
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  map?: unknown;
  needsUpdate?: boolean;
  // MToon (three-vrm) extras — all optional, touched only when present.
  shadeColorFactor?: THREE.Color;
  shadeMultiplyTexture?: unknown;
}

function tintIris(mat: LookMaterial, fallbackName: string): boolean {
  const name = String(mat?.name ?? fallbackName ?? "");
  if (!IRIS_RE.test(name) || EYE_EXCLUDE_RE.test(name)) return false;
  let touched = false;
  // Base colour is what actually reads (MToon emissive barely shows over the brown iris texture, as
  // the first cut proved). Clear the iris texture and drive the iris from the red factor, the same
  // way the hair recolour works, so the eye is unmistakably red.
  if (mat.color && typeof mat.color.set === "function") {
    if ("map" in mat) mat.map = null;
    mat.color.set(KAMIKO_AWAKE_NEON);
    if (mat.shadeColorFactor && typeof mat.shadeColorFactor.set === "function") {
      mat.shadeColorFactor.set(KAMIKO_AWAKE_NEON);
    }
    touched = true;
  }
  // …and glow on top of the red base so the awake eye reads as lit in a dark scene.
  if (mat.emissive && typeof mat.emissive.set === "function") {
    mat.emissive.set(KAMIKO_AWAKE_NEON);
    mat.emissiveIntensity = Math.max(mat.emissiveIntensity ?? 0, 1.5);
    touched = true;
  }
  if (touched) mat.needsUpdate = true;
  return touched;
}

function whitenHair(mat: LookMaterial, fallbackName: string): boolean {
  const name = String(mat?.name ?? fallbackName ?? "");
  if (!HAIR_RE.test(name)) return false;
  if (!mat.color || typeof mat.color.set !== "function") return false;
  // Clear the base texture so the (dark) stock hair texture can't override the silver factor.
  if ("map" in mat) mat.map = null;
  mat.color.set(KAMIKO_HAIR);
  // MToon: shade + shade texture, so lit and shadowed strands are both silver.
  if (mat.shadeColorFactor && typeof mat.shadeColorFactor.set === "function") {
    mat.shadeColorFactor.set(KAMIKO_HAIR_SHADE);
  }
  if ("shadeMultiplyTexture" in mat) mat.shadeMultiplyTexture = null;
  mat.needsUpdate = true;
  return true;
}

function tintOutfit(mat: LookMaterial, fallbackName: string): boolean {
  const name = String(mat?.name ?? fallbackName ?? "");
  if (!OUTFIT_RE.test(name) || OUTFIT_EXCLUDE_RE.test(name)) return false;
  if (!mat.color || typeof mat.color.set !== "function") return false;
  // A cool MULTIPLY tint — keeps the outfit's texture detail, shifts it toward techwear panel-gray.
  // Deliberately NOT emissive: the outfit is not a light source, only the awake eye is.
  mat.color.set(KAMIKO_OUTFIT_TINT);
  if (mat.shadeColorFactor && typeof mat.shadeColorFactor.set === "function") {
    mat.shadeColorFactor.set(KAMIKO_OUTFIT_TINT);
  }
  mat.needsUpdate = true;
  return true;
}

/**
 * Restyle `vrm` into Kamiko (white hair + neon-green awake eye). Returns `{ eyes, hair }` counts of
 * materials changed (0/0 = the model exposed no recognisable iris/hair material; harmless). Never
 * throws.
 */
export function applyKamikoLook(vrm: VRM): { eyes: number; hair: number; outfit: number } {
  let eyes = 0;
  let hair = 0;
  let outfit = 0;
  try {
    vrm.scene.traverse((obj: THREE.Object3D) => {
      const material = (obj as unknown as { material?: LookMaterial | LookMaterial[] }).material;
      if (!material) return;
      const mats = Array.isArray(material) ? material : [material];
      for (const mat of mats) {
        if (tintIris(mat, obj.name)) eyes += 1;
        else if (whitenHair(mat, obj.name)) hair += 1;
        else if (tintOutfit(mat, obj.name)) outfit += 1;
      }
    });
  } catch {
    // A cosmetic treatment must never be able to break model loading.
  }
  return { eyes, hair, outfit };
}
