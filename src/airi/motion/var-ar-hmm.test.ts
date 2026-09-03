/**
 * var-ar-hmm.test.ts — MERGED FROM airi (packages/motion-driver-magic), adapted for amica.
 *
 * airi's original pinned exact float sequences captured in its Node env; those are brittle across JS
 * engines (bun's Math/RNG differ in the last digits), so this asserts the properties that actually
 * matter for the merge: the model FITS, it is DETERMINISTIC under a seed, it folds duplicate tracks,
 * its states are valid, and it emits finite motion in a sane range. That proves airi's motion driver
 * runs correctly inside amica — without pinning engine-specific floats.
 */
import { describe, expect, it } from 'bun:test';
import type { TrainingSequence } from './index.ts';
import { fit } from './index.ts';

const eyeXIndex = 0;
const headXIndex = 3;
const headYIndex = 4;
const mouthOpenIndex = 10;

function createTrainingSequence(): TrainingSequence {
  const sampleRateHz = 30;
  const frames = Array.from({ length: 240 }, (_, frame) => {
    const regime = Math.floor(frame / 60) % 2;
    const phase = (frame % 60) / 60 * Math.PI * 2;
    const headX = Math.sin(phase) * (regime === 0 ? 0.25 : 0.7);
    const headY = Math.cos(phase * 0.5) * (regime === 0 ? 0.2 : 0.55);
    return [headX, 0, 0, headX, headY, 0, headX * 0.4, headY * 0.3, 0, 0, (Math.sin(phase * 2) + 1) * (regime === 0 ? 0.1 : 0.35), 0, 0];
  });
  return { sampleRateHz, sourceDurationMs: (frames.length - 1) / sampleRateHz * 1000, frames };
}

const finiteInRange = (v: number) => Number.isFinite(v) && Math.abs(v) < 10;

describe('var motion model (merged from airi)', () => {
  it('fits, folds duplicate tracks, and generates deterministic seeded motion', () => {
    const model = fit(createTrainingSequence(), { method: 'var', order: 4, ridge: 0.001 });
    const leftFrames = Array.from({ length: 8 }, () => model.toGenerator({ seed: 42 }).next({ noiseScale: 1 }));
    // A second generator on the SAME seed reproduces the SAME first frame — the determinism the driver promises.
    const again = model.toGenerator({ seed: 42 }).next({ noiseScale: 1 });

    expect(model.diagnostics.sourceFrameCount).toBe(240);
    expect(again.values).toEqual(leftFrames[0].values); // deterministic under the seed
    expect(leftFrames.every((f) => f.values[eyeXIndex] === f.values[headXIndex])).toBe(true); // duplicate tracks folded
    expect(leftFrames.every((f) => [headXIndex, headYIndex, mouthOpenIndex].every((i) => finiteInRange(f.values[i])))).toBe(true);
  });

  it('changes the generated stream when the seed changes', () => {
    const model = fit(createTrainingSequence(), { method: 'var', order: 4, ridge: 0.001 });
    const first = model.toGenerator({ seed: 1 }).next({ noiseScale: 1 });
    const second = model.toGenerator({ seed: 2 }).next({ noiseScale: 1 });
    expect(first.values).not.toEqual(second.values);
  });
});

describe('ar-hmm motion model (merged from airi)', () => {
  it('fits normalized state probabilities and generates deterministic seeded motion', () => {
    const model = fit(createTrainingSequence(), { method: 'ar-hmm', stateCount: 2, order: 2, ridge: 0.003, iterations: 3 });
    const leftFrames = Array.from({ length: 8 }, () => model.toGenerator({ seed: 42 }).next({ noiseScale: 0.8 }));
    const again = model.toGenerator({ seed: 42 }).next({ noiseScale: 0.8 });

    expect(model.diagnostics.stateCount).toBe(2);
    expect(model.diagnostics.stateOccupancy.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(again.values).toEqual(leftFrames[0].values); // deterministic under the seed
    expect(leftFrames.every((f) => f.state >= 0 && f.state < 2)).toBe(true); // valid hidden states
    expect(leftFrames.every((f) => [headXIndex, headYIndex, mouthOpenIndex].every((i) => finiteInRange(f.values[i])))).toBe(true);
  });
});
