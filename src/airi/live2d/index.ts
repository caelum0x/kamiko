/**
 * MERGED FROM airi (apps/airi/packages/model-driver-magic-live2d), MIT.
 * A Live2D avatar motion driver — a capability amica (VRM-only) lacked. Builds on the merged
 * motion-driver (../motion); its one es-toolkit fn (clamp) is vendored, so it is fully local.
 * Upstream: https://github.com/moeru-ai/airi
 */
export * from './driver'
export * from './filter'
export * from './pose'