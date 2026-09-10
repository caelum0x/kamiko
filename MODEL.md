# Kamiko avatar model — status & drop-in spec

## Current state
The shipped 3D avatar loads `public/vrm/npc.vrm`, which is **a placeholder** — a symlink to the stock
VRoid `AvatarSample_B.vrm`. There is **no authored custom Kamiko model** yet. Authoring a VRM (body,
face, hair, outfit, rig) is a 3D-art deliverable (VRoid Studio / Blender / a commissioned or AI-art
pipeline) — it cannot be produced in application code.

## What the code already does (the "custom" that code can do)
- **Canonical path:** the default model is now `config.vrm_url = /vrm/npc.vrm` (was the stock sample),
  and the env override bug is fixed (`NEXT_PUBLIC_VRM_URL`). **Replace the `public/vrm/npc.vrm` symlink
  with the authored Kamiko `.vrm` and it goes live with zero config change.**
- **Signature look at runtime:** `src/features/vrmViewer/kamikoLook.ts` implements the character's
  `heterochromia` flag (which nothing read before) — it sets the **awake neon-green glow (`#00ffa3`)**
  on the iris material(s) of whatever VRM is loaded, so even the placeholder reads as Kamiko. Gated by
  `config.kamiko_heterochromia` ('true' default); cosmetic + defensive (never throws, no-ops if no
  iris material). On a shared-iris sample both eyes glow; a true **one-asleep / one-glowing** split
  needs the authored model (separate iris materials or an eye-asleep blendshape).
- **Mobile perf:** device pixel ratio is capped at 2 (`viewer.ts`) so the full-viewport canvas + 15 MB
  model does not render at 3× DPR on phones (the 390px target).

## The authored-model spec (for whoever makes it)
From `brand/BRAND.md` + `packages/character-kit/npc.character.json`:
- 3D **anime girl** VTuber, VRM (VRM1 preferred; VRM0 is auto-rotated). Neuro-sama energy.
- **Heterochromia / "only half woke up":** left eye **asleep** (a flat dull line / half-lid), right eye
  **awake, glowing neon-green** `#00ffa3`. This is THE tell — keep the two irises as separate materials
  so the glow (and a future "asleep eye blinks open" beat) can target one eye.
- Palette accents: awake neon `#00ffa3`, violet `#8b5cf6`, hot `#ff2e63`, ink `#06060b`.
- Standard VRM humanoid rig + blendshapes for the 14 expressions the app drives (`neutral, happy,
  angry, sad, relaxed, Surprised, Shy, Jealous, Bored, Serious, Suspicious, Victory, Sleep, Love` —
  `src/features/chat/messages.ts`) and the `aa/ee/ih/oh/ou` visemes for lip-sync.
- Keep the download reasonable for mobile (target < ~10 MB; the stock sample is 15 MB — see the dead
  `src/utils/textureDownscaler.ts` / `gltfOptimizer.ts` if a compression pass is wanted).

## How to produce it
1. VRoid Studio: design the girl, set the two eyes (one dull/half-lid, one emissive neon-green iris as
   its own material), export VRM. OR commission / AI-art-to-VRM pipeline.
2. Save as `apps/vtuber-amica/public/vrm/npc.vrm` (replace the symlink with the real file).
3. Verify: `npm run dev`, open `/`, confirm she loads, the awake eye glows, expressions + lip-sync work.
4. Optional: set `config.kamiko_heterochromia = 'false'` once the model bakes the glow itself.

## Next frontend upgrades (see STOCKMETA-PLAN.md §airi)
- Turn on the AIRI statistical idle (`animation_procedural`, currently off) once verified against the
  VRMA idle clip.
- Wire the ported-but-dead `src/airi/pipelines-audio` (sentence-chunked streaming TTS + `[emotion]`
  token parsing) to replace amica's ad-hoc ttsJobs.
- Feed `viewer.mouse` into the lookAt smoother so she tracks the pointer (currently gazes at camera).
