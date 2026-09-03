/**
 * MERGED FROM airi (apps/airi/packages/motion-driver-magic), MIT.
 * A pure, self-contained statistical motion generator (AR-HMM / VAR) that produces seeded, deterministic
 * MotionValues sequences for procedural idle avatar animation. Framework-agnostic; the one es-toolkit
 * dependency (clamp) is vendored in ./shared/clamp.ts, so it has zero external deps. Feeds amica's VRM
 * stage. Upstream: https://github.com/moeru-ai/airi
 */
export { createArHmmModel } from './ar-hmm'
export type {
  Diagnostics as ArHmmDiagnostics,
  FitOptions as ArHmmFitOptions,
  ArHmmModel,
} from './ar-hmm'
export * from './fit'
export * from './types'
export { createVarModel } from './var'
export type {
  Diagnostics as VarDiagnostics,
  FitOptions as VarFitOptions,
  VarModel,
} from './var'