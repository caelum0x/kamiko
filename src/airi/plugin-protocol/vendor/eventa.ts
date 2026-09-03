/**
 * Minimal, vendored replacement for @moeru/eventa — just what airi's plugin-protocol needs to define
 * its typed event descriptors. An Eventa is an id-keyed descriptor carrying (phantom) payload +
 * metadata types; defineEventa builds one. This is enough to MERGE airi's full VTuber-control
 * protocol as a typed contract into amica without pulling airi's whole event runtime.
 */
export interface Eventa<P = undefined, M = unknown, IM = unknown> {
  readonly id: string;
  readonly __payload?: P;
  readonly __metadata?: M;
  readonly __invokeMetadata?: IM;
}
export function defineEventa<P = undefined, M = unknown, IM = unknown>(
  id: string,
  options?: { metadata?: M; invokeMetadata?: IM },
): Eventa<P, M, IM> {
  return { id, __metadata: options?.metadata, __invokeMetadata: options?.invokeMetadata };
}
