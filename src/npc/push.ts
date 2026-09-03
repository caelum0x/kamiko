/**
 * push.ts — the browser half of the streak-saver return hook.
 *
 * services/game-api ships the whole server side of this (webpush.ts mints and signs the VAPID JWT,
 * push.ts sweeps players whose streak is about to lapse, push-admin.ts authenticates the operator's
 * sweep tick) and it was UNREACHABLE: nothing in the product ever registered a service worker or
 * called POST /push/subscribe, so `push_subs` stayed empty and every sweep found nothing to send.
 * This is the missing client.
 *
 * The rules it fails closed on, all of them the same rule — never offer a subscription that cannot
 * be pushed to:
 *   - NO VAPID KEY, NO OFFER. A subscription minted against a different applicationServerKey is one
 *     this deployment's server can never push to. `NEXT_PUBLIC_NPC_VAPID` must be the public half of
 *     the api's own `NPC_VAPID_PUBLIC_KEY`/`NPC_VAPID_PRIVATE_KEY` pair.
 *   - NO IDENTITY, NO SUBSCRIBE. npc-api refuses an anonymous subscription (`kind === 'anon'` ⇒
 *     400), because a push row it cannot attribute to a player is a row it can never target.
 *   - PERMISSION IS ASKED ON A GESTURE, NEVER ON LOAD. Browsers penalise (and Chrome outright
 *     blocks) a permission prompt that no user action asked for.
 */
import getConfig from 'next/config';

import { API, VAPID, apiDeadline } from './config.ts';
import { TZ, sessionHeaders } from './identity.ts';

/**
 * Path of the service worker that renders the notifications.
 *
 * That worker is the one @ducanh2912/next-pwa generates into public/ at build time, with our
 * push/notificationclick handlers (apps/vtuber-amica/worker/index.js) compiled into it through
 * next.config.js's `customWorkerSrc`. There is exactly one worker and one registration at scope '/':
 * registering a second script there would replace amica's PWA registration.
 *
 * The basePath prefix matters because amica supports being served under one (next.config.js reads
 * BASE_PATH and publishes it as `publicRuntimeConfig.root`). Registering a bare '/sw.js' under a
 * base path asks for a file that is not there, and the browser reports it as a plain 404 — a
 * notification feature that is simply, silently absent on exactly the deployments that use a prefix.
 */
export function swPath(): string {
  let root = '';
  try { root = (getConfig()?.publicRuntimeConfig?.root as string) || ''; } catch { root = ''; }
  return (root.replace(/\/+$/, '') || '') + '/sw.js';
}

/** Does this browser have everything the streak saver needs? */
export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

/** Is the streak saver offerable at all here — supported, configured, and not already denied? */
export function pushOfferable(): boolean {
  if (!pushSupported() || !VAPID || !API) return false;
  return Notification.permission !== 'denied';
}

/**
 * PURE. Decode a base64url VAPID public key into the raw bytes `PushManager.subscribe` wants.
 * Returns null for anything that is not a decodable key, which leaves the offer unrendered rather
 * than throwing inside a click handler.
 */
export function vapidKeyBytes(base64url: string): Uint8Array | null {
  const key = (base64url || '').trim();
  if (!key) return null;
  try {
    const padded = key.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (key.length % 4)) % 4);
    const raw = atob(padded);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    // An uncompressed P-256 point: 65 bytes starting 0x04. Anything else is not a VAPID key, and
    // subscribing with it throws inside the browser rather than telling us what went wrong.
    return out.length === 65 && out[0] === 0x04 ? out : null;
  } catch {
    return null;
  }
}

export type SubscribeResult =
  | { ok: true; alreadySubscribed: boolean }
  | { ok: false; why: string };

/** Register the notification service worker, returning its registration (or null on failure). */
export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register(swPath());
  } catch {
    return null; // an http:// origin, a blocked worker, a browser with SW disabled
  }
}

/**
 * Ask for permission, subscribe, and register the subscription with npc-api.
 *
 * MUST be called from a user gesture. Every failure returns a sentence the page can show; nothing
 * here throws, because the caller is a click handler on a button people press once.
 */
export async function subscribeToStreakSaver(identity: { wallet: string; device: string }): Promise<SubscribeResult> {
  if (!pushSupported()) return { ok: false, why: 'this browser cannot do web push (try Chrome, Edge, or install this as an app on iOS).' };
  if (!API) return { ok: false, why: 'the funnel api is not configured, so there is nothing to subscribe to.' };
  const key = vapidKeyBytes(VAPID);
  if (!key) return { ok: false, why: 'push is not configured on this deployment — no valid VAPID key, so no subscription could ever be delivered.' };
  // npc-api refuses an anonymous subscription, so refuse it here too rather than posting a 400.
  const id = identity.wallet || identity.device;
  if (!id) return { ok: false, why: 'tap at least once first — a reminder needs somebody to remind.' };

  let permission: NotificationPermission;
  try { permission = await Notification.requestPermission(); }
  catch { return { ok: false, why: 'the browser refused the notification prompt.' }; }
  if (permission !== 'granted') return { ok: false, why: 'notifications are off — she cannot remind you without them.' };

  const reg = await registerWorker();
  if (!reg) return { ok: false, why: 'the notification worker could not be registered (this needs https).' };

  let sub: PushSubscription | null = null;
  let already = false;
  try {
    // `ready` rather than the raw registration: subscribing against a worker that has not activated
    // yet is the intermittent failure that makes this button work only on the second press.
    const ready = await navigator.serviceWorker.ready;
    const existing = await ready.pushManager.getSubscription();
    if (existing) {
      // Re-post it anyway (below): the row carries the CURRENT streak and tz, and npc-api upserts on
      // endpoint. Re-registering a subscription the server may have pruned is the point.
      sub = existing;
      already = true;
    } else {
      sub = await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
  } catch {
    return { ok: false, why: 'the browser would not create a push subscription.' };
  }
  if (!sub) return { ok: false, why: 'the browser returned no push subscription.' };

  try {
    const res = await fetch(API + '/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...sessionHeaders(identity.wallet) },
      signal: apiDeadline(),
      body: JSON.stringify({
        subscription: sub.toJSON(),
        wallet: identity.wallet || undefined,
        device: identity.device || undefined,
        tz: TZ,
      }),
    });
    if (!res.ok) {
      // The browser now holds a subscription the server does not know about. Drop it, so the button
      // offers a real retry instead of silently doing nothing next time.
      if (!already) { try { await sub.unsubscribe(); } catch { /* best effort */ } }
      return { ok: false, why: `the api would not register the reminder (HTTP ${res.status}).` };
    }
    const body = (await res.json().catch(() => null)) as { ok?: unknown } | null;
    if (!body || body.ok !== true) {
      if (!already) { try { await sub.unsubscribe(); } catch { /* best effort */ } }
      return { ok: false, why: 'the api did not confirm the reminder was registered.' };
    }
  } catch {
    if (!already) { try { await sub.unsubscribe(); } catch { /* best effort */ } }
    return { ok: false, why: 'could not reach the api — nothing was registered.' };
  }
  return { ok: true, alreadySubscribed: already };
}

/** Is there already a push subscription in this browser? Never throws. */
export async function hasSubscription(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.getRegistration(swPath());
    if (!reg) return false;
    return (await reg.pushManager.getSubscription()) !== null;
  } catch {
    return false;
  }
}
