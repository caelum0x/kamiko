/** Vendored from es-toolkit/math (MIT) — the only es-toolkit function airi's motion driver used. */
export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
