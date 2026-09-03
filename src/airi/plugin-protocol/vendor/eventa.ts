/**
 * Minimal, vendored replacement for @moeru/eventa — just what airi's plugin-protocol needs to define
 * its typed event descriptors. An Eventa is an id-keyed descriptor carrying a phantom payload type
 * plus the runtime metadata attached at definition time; defineEventa builds one. This is enough to
 * MERGE airi's full VTuber-control protocol as a typed contract into amica without pulling airi's
 * whole event runtime.
 *
 * THE FIELD NAMES ARE PART OF THE CONTRACT, not an internal detail. This shim originally stored the
 * metadata as `__metadata` / `__invokeMetadata`, while the code it exists to serve — events.ts's
 * `protocolEventMetadataByType`, which is what `getProtocolEventMetadata()` reads — asks for
 * `.metadata`. So every lookup resolved to `undefined`: the three input events that carry metadata
 * (input:text, input:text:voice, input:voice) reported none, and nothing failed loudly about it.
 *
 * The real @moeru/eventa (installed here, dist/context-*.d.mts) declares them as `metadata` and
 * `invokeMetadata`. This shim now matches that exactly, so swapping the vendored copy for the npm
 * package is a one-line import change rather than a behaviour change. Only the PAYLOAD stays a
 * phantom `__payload`, because it is a type-level marker with no runtime value — which is precisely
 * why it is the only one that may carry a name the real package does not use.
 */
export interface Eventa<P = undefined, M = unknown, IM = unknown> {
  readonly id: string;
  /** Phantom: carries the payload type only. There is never a runtime value here. */
  readonly __payload?: P;
  /** Runtime metadata attached when the eventa was defined. */
  readonly metadata?: M;
  /** Runtime metadata that applies when the eventa is invoked. */
  readonly invokeMetadata?: IM;
}

export function defineEventa<P = undefined, M = unknown, IM = unknown>(
  id: string,
  options?: { inheritFrom?: Eventa<P, M, IM>; metadata?: M; invokeMetadata?: IM },
): Eventa<P, M, IM> {
  // `inheritFrom` is part of the real signature and airi's protocol passes it: an eventa defined
  // from a parent takes the parent's metadata unless it states its own. Dropping the option on the
  // floor (as this shim did) silently loses the inherited metadata.
  const parent = options?.inheritFrom;
  return {
    id,
    metadata: options?.metadata ?? parent?.metadata,
    invokeMetadata: options?.invokeMetadata ?? parent?.invokeMetadata,
  };
}
