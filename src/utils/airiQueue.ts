/**
 * airiQueue.ts — MERGED FROM airi (apps/airi/packages/stream-kit/src/queue.ts), MIT.
 *
 * airi is the other VTuber platform this repo vendors. Its UI is Vue and cannot be dropped into
 * amica's React tree, but its framework-agnostic TypeScript can — this is one of those pieces,
 * copied in verbatim (zero dependencies) so $NPC gains airi's capability without a rewrite. It is a
 * generic async processing queue: items are enqueued, drained one at a time through a list of async
 * handlers, and every stage (enqueue / dequeue / process / result / error / drain) emits an event a
 * caller can observe. The game uses it for a resilient /wake send pipeline (see game.tsx).
 *
 * Upstream: https://github.com/moeru-ai/airi — packages/stream-kit.
 */

export interface HandlerContext<T> {
  data: T;
  emit: (eventName: string, ...params: any[]) => void;
}

export interface Events<T> {
  enqueue: Array<(payload: T, queueLength: number) => void>;
  dequeue: Array<(payload: T, queueLength: number) => void>;
  process: Array<(payload: T, handler: (param: HandlerContext<T>) => Promise<any>) => void>;
  error: Array<(payload: T, error: unknown, handler: (param: HandlerContext<T>) => Promise<any>) => void>;
  result: Array<<R>(payload: T, result: R, handler: (param: HandlerContext<T>) => Promise<any>) => void>;
  drain: Array<() => void>;
}

export function createQueue<T>(options: {
  handlers: Array<(ctx: HandlerContext<T>) => Promise<void>>;
}) {
  const queue: T[] = [];
  let drainTask: Promise<any> | undefined;

  const internalEventListeners: Events<T> = { enqueue: [], dequeue: [], process: [], error: [], result: [], drain: [] };
  const internalHandlerEventListeners: Record<string, Array<(...params: any[]) => void>> = {};

  function on<E extends keyof Events<T>>(eventName: E, listener: Events<T>[E][number]) {
    internalEventListeners[eventName].push(listener as any);
  }

  function emit<E extends keyof Events<T>>(eventName: E, ...params: Parameters<Events<T>[E][number]>) {
    const listeners = internalEventListeners[eventName] as Events<T>[E];
    listeners.forEach((listener) => (listener as any)(...params));
  }

  function onHandlerEvent(eventName: string, listener: (...params: any[]) => void) {
    internalHandlerEventListeners[eventName] = internalHandlerEventListeners[eventName] || [];
    internalHandlerEventListeners[eventName].push(listener);
  }

  function emitHandlerEvent(eventName: string, ...params: any[]) {
    const listeners = internalHandlerEventListeners[eventName] || [];
    listeners.forEach((listener) => listener(...params));
  }

  function enqueue(payload: T) {
    queue.push(payload);
    emit('enqueue', payload, queue.length);
    if (!drainTask) drainTask = drain();
  }

  function clear() {
    queue.length = 0;
  }

  async function drain() {
    while (queue.length > 0) {
      const payload = queue.shift() as T;
      emit('dequeue', payload, queue.length);
      for (const handler of options.handlers) {
        emit('process', payload, handler);
        try {
          const result = await handler({ data: payload, emit: emitHandlerEvent });
          emit('result', payload, result, handler);
        } catch (err) {
          emit('error', payload, err, handler);
          continue;
        }
      }
    }
    emit('drain');
    drainTask = undefined;
  }

  function length() {
    return queue.length;
  }

  return { enqueue, clear, length, on, onHandlerEvent };
}

export type UseQueueReturn<T> = ReturnType<typeof createQueue<T>>;
