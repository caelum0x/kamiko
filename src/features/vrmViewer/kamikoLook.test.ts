import { describe, expect, it } from "@jest/globals";
import {
  applyKamikoLook,
  KAMIKO_AWAKE_NEON,
  KAMIKO_HAIR,
  KAMIKO_HAIR_SHADE,
} from "@/features/vrmViewer/kamikoLook";

/**
 * Unit tests for applyKamikoLook — the cosmetic restyle (neon awake-eye glow + white/silver hair).
 *
 * These build a minimal fake VRM ({ scene: { traverse } }) whose traverse yields fake meshes with
 * fake materials, so no real three.js/VRM asset is needed. `emissive` / `color` / `shadeColorFactor`
 * are stubs whose `set` records the value they were given, letting us assert exactly what was changed.
 *
 * applyKamikoLook returns `{ eyes, hair }` — the count of iris materials lit and hair materials
 * recoloured — so the iris-count assertions read `.eyes`.
 */

type FakeColor = { _v?: number; set: (v: number) => void };

interface FakeMaterial {
  name?: string;
  color?: FakeColor;
  emissive?: FakeColor;
  emissiveIntensity?: number;
  needsUpdate?: boolean;
  map?: unknown;
  shadeColorFactor?: FakeColor;
  shadeMultiplyTexture?: unknown;
}

function makeColor(): FakeColor {
  return {
    set(v: number) {
      this._v = v;
    },
  };
}

/** An iris/eye-style material (has an emissive channel). */
function eyeMat(name: string, opts?: { noEmissive?: boolean; intensity?: number }): FakeMaterial {
  return {
    name,
    emissive: opts?.noEmissive ? undefined : makeColor(),
    emissiveIntensity: opts?.intensity,
  };
}

interface FakeObject {
  name: string;
  material?: FakeMaterial | FakeMaterial[];
}

/** Build a VRM-like object whose scene.traverse walks the provided fake meshes. */
function fakeVrm(objects: FakeObject[]) {
  return {
    scene: {
      traverse(cb: (obj: unknown) => void) {
        for (const obj of objects) cb(obj);
      },
    },
  } as unknown as Parameters<typeof applyKamikoLook>[0];
}

describe("applyKamikoLook", () => {
  it("exports the awake-eye and hair colours as valid, distinct 24-bit values", () => {
    // The exact hex is a brand/art decision that may be tuned, so assert the contract (valid,
    // distinct RGB integers) rather than pinning a specific colour that art can legitimately change.
    for (const colour of [KAMIKO_AWAKE_NEON, KAMIKO_HAIR, KAMIKO_HAIR_SHADE]) {
      expect(Number.isInteger(colour)).toBe(true);
      expect(colour).toBeGreaterThanOrEqual(0x000000);
      expect(colour).toBeLessThanOrEqual(0xffffff);
    }
    // The awake eye is a different colour from the hair (it is the character's one visual tell).
    expect(KAMIKO_AWAKE_NEON).not.toBe(KAMIKO_HAIR);
  });

  it("lights only iris materials and returns their count in .eyes", () => {
    const iris1 = eyeMat("EyeIris");
    const iris2 = eyeMat("F00_EyeIris_00_EYE");
    const white = eyeMat("EyeWhite");
    const face = eyeMat("Face");

    const vrm = fakeVrm([
      { name: "m0", material: iris1 },
      { name: "m1", material: iris2 },
      { name: "m2", material: white },
      { name: "m3", material: face },
    ]);

    const result = applyKamikoLook(vrm);

    expect(result.eyes).toBe(2);
    // iris materials glow with the neon colour at full intensity
    expect(iris1.emissive?._v).toBe(KAMIKO_AWAKE_NEON);
    expect(iris1.emissiveIntensity).toBe(1);
    expect(iris1.needsUpdate).toBe(true);
    expect(iris2.emissive?._v).toBe(KAMIKO_AWAKE_NEON);
    // sclera / face are untouched
    expect(white.emissive?._v).toBeUndefined();
    expect(face.emissive?._v).toBeUndefined();
  });

  it("excludes the white, shine, lash and brow even when the name is iris-ish", () => {
    const highlight = eyeMat("EyeIris_highlight");
    const lash = eyeMat("F00_EyeIris_lash");
    const brow = eyeMat("iris_brow");

    const vrm = fakeVrm([
      { name: "m0", material: highlight },
      { name: "m1", material: lash },
      { name: "m2", material: brow },
    ]);

    const result = applyKamikoLook(vrm);

    expect(result.eyes).toBe(0);
    expect(highlight.emissive?._v).toBeUndefined();
    expect(lash.emissive?._v).toBeUndefined();
    expect(brow.emissive?._v).toBeUndefined();
  });

  it("does not lower an already-brighter emissiveIntensity", () => {
    const bright = eyeMat("EyeIris", { intensity: 3 });
    const vrm = fakeVrm([{ name: "m0", material: bright }]);

    expect(applyKamikoLook(vrm).eyes).toBe(1);
    expect(bright.emissiveIntensity).toBe(3); // max(3, 1) === 3
  });

  it("never throws on an iris material with no emissive channel", () => {
    const noEmissive = eyeMat("EyeIris", { noEmissive: true });
    const vrm = fakeVrm([{ name: "m0", material: noEmissive }]);

    let result: ReturnType<typeof applyKamikoLook> | undefined;
    expect(() => {
      result = applyKamikoLook(vrm);
    }).not.toThrow();
    expect(result?.eyes).toBe(0);
  });

  it("handles material arrays and meshes with no material", () => {
    const iris = eyeMat("EyeIris");
    const skin = eyeMat("Skin");
    const vrm = fakeVrm([
      { name: "grouped", material: [iris, skin] },
      { name: "nomat" }, // no material at all — must be skipped, not throw
    ]);

    expect(applyKamikoLook(vrm).eyes).toBe(1);
    expect(iris.emissive?._v).toBe(KAMIKO_AWAKE_NEON);
    expect(skin.emissive?._v).toBeUndefined();
  });

  it("resolves the iris name from the mesh name when the material is unnamed", () => {
    const unnamed = eyeMat("");
    unnamed.name = undefined;
    const vrm = fakeVrm([{ name: "F00_EyeIris_00_EYE", material: unnamed }]);

    expect(applyKamikoLook(vrm).eyes).toBe(1);
    expect(unnamed.emissive?._v).toBe(KAMIKO_AWAKE_NEON);
  });

  it("reports 0 eyes / 0 hair for a model with no recognisable iris or hair material", () => {
    // Neutral names: neither iris- nor hair-like. (toMatchObject tolerates any additional
    // dimensions the restyle may grow, e.g. an outfit tint — we only assert eyes/hair here.)
    const vrm = fakeVrm([
      { name: "m0", material: eyeMat("Body") },
      { name: "m1", material: eyeMat("Skin") },
    ]);
    expect(applyKamikoLook(vrm)).toMatchObject({ eyes: 0, hair: 0 });
  });

  it("recolours hair to silver, clears the base + shade textures, and counts it in .hair", () => {
    const hairMat: FakeMaterial = {
      name: "Hair",
      color: makeColor(),
      map: { some: "texture" },
      shadeColorFactor: makeColor(),
      shadeMultiplyTexture: { some: "shadeTexture" },
    };
    const vrm = fakeVrm([{ name: "m0", material: hairMat }]);

    const result = applyKamikoLook(vrm);

    expect(result.hair).toBe(1);
    expect(result.eyes).toBe(0);
    expect(hairMat.color?._v).toBe(KAMIKO_HAIR);
    expect(hairMat.shadeColorFactor?._v).toBe(KAMIKO_HAIR_SHADE);
    expect(hairMat.map).toBeNull();
    expect(hairMat.shadeMultiplyTexture).toBeNull();
    expect(hairMat.needsUpdate).toBe(true);
  });
});
