import * as THREE from "three";
import type { VRM } from "@pixiv/three-vrm";

/**
 * kamikoLook.ts — Kamiko's signature applied to whatever VRM is loaded.
 *
 * The character is defined (packages/character-kit/npc.character.json, brand/BRAND.md) by ONE visual
 * beat: she "only half woke up" — the awake eye glows neon-green (`#00ffa3`, BRAND's "awake neon").
 * `npc.character.json` sets `avatar.heterochromia: true`, and until now NOTHING read that flag: the
 * shipped model is a stock VRoid sample with plain eyes. This gives even the placeholder her tell.
 *
 * It sets an EMISSIVE glow on the iris material(s) of the loaded VRM. On a VRoid sample both irises
 * share one material, so both glow — a true one-asleep/one-glowing split needs the authored model
 * (drop it in at public/vrm/npc.vrm and this still applies the glow). Sclera / highlights / lashes /
 * brows are excluded so only the coloured iris lights up.
 *
 * COSMETIC AND DEFENSIVE: it only ever touches an `emissive` channel, is wrapped so it can never
 * throw into model loading, and no-ops when no iris material is found or a material has no emissive.
 */

/** BRAND.md "awake neon". */
export const KAMIKO_AWAKE_NEON = 0x00ffa3;

/** Iris-ish material/mesh names across VRoid / VRM exporters. */
const IRIS_RE = /iris|pupil|hitomi|_eye(_|$|iris)/i;
/** Never light these up — they are the white, the shine, or the frame of the eye, not the colour. */
const EXCLUDE_RE = /white|sclera|highlight|shadow|lash|line|brow|extra/i;

interface EmissiveMaterial {
  name?: string;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
  needsUpdate?: boolean;
}

function tintIris(mat: EmissiveMaterial, fallbackName: string): boolean {
  const name = String(mat?.name ?? fallbackName ?? "");
  if (!IRIS_RE.test(name) || EXCLUDE_RE.test(name)) return false;
  if (!mat.emissive || typeof mat.emissive.set !== "function") return false;
  mat.emissive.set(KAMIKO_AWAKE_NEON);
  mat.emissiveIntensity = Math.max(mat.emissiveIntensity ?? 0, 1.0);
  mat.needsUpdate = true;
  return true;
}

/**
 * Apply Kamiko's awake-eye glow to `vrm`. Returns how many iris materials were lit (0 = the model had
 * no recognisable iris material; harmless). Never throws.
 */
export function applyKamikoLook(vrm: VRM): number {
  let lit = 0;
  try {
    vrm.scene.traverse((obj: THREE.Object3D) => {
      const material = (obj as unknown as { material?: EmissiveMaterial | EmissiveMaterial[] }).material;
      if (!material) return;
      const mats = Array.isArray(material) ? material : [material];
      for (const mat of mats) if (tintIris(mat, obj.name)) lit += 1;
    });
  } catch {
    // A cosmetic treatment must never be able to break model loading.
  }
  return lit;
}
