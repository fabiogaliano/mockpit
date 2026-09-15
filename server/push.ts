// Web Push (VAPID + aes128gcm) and outbound webhooks, runtime-agnostic: Web
// Crypto and fetch only, no `node:` imports, so the same code runs on Node and
// on the Durable Object. Keys and subscriptions live in workspace settings.
//
// Nothing here may block or fail a write: every send is fire-and-forget and
// every failure is logged. The operator's phone missing a notification is a
// nuisance; a publish failing because a push endpoint is down is data loss.

import type { Store } from "./types.ts";

const VAPID_KEY = "push:vapid";
const SUBS_KEY = "push:subs";
const HOOKS_KEY = "hooks";
// Contact for the push service, per the VAPID spec. A mailto is required; this
// deployment has no operator address, so use the project's.
const VAPID_SUBJECT = "mailto:sideshow@sideshow.sh";

export interface PushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface Hook {
  id: string;
  url: string;
  events: HookEvent[];
}

export type HookEvent = "ask" | "publish" | "decision";

export interface NotifyPayload {
  event: HookEvent;
  project: string;
  slug: string;
  variant: string;
  version: number;
  text: string;
  url: string;
}

// --- base64url ---

const b64uEncode = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const b64uDecode = (input: string): Uint8Array => {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

const utf8 = (s: string) => new TextEncoder().encode(s);

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

// Web Crypto wants a definite ArrayBuffer, not a possibly-shared view.
const buf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

// The node program (no DOM lib) and @cloudflare/workers-types declare Web Crypto
// with incompatible shapes: generateKey returns a `CryptoKey | CryptoKeyPair`
// union, JsonWebKey requires `kty`, and ECDH's peer-key field is spelled
// differently. This file must typecheck under both programs, so it reaches the
// standard API through one narrow declaration of exactly the calls it makes.
interface SubtleLike {
  generateKey(
    algorithm: { name: string; namedCurve: string },
    extractable: boolean,
    usages: string[],
  ): Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }>;
  exportKey(format: "jwk", key: CryptoKey): Promise<Jwk>;
  exportKey(format: "raw", key: CryptoKey): Promise<ArrayBuffer>;
  importKey(
    format: "jwk" | "raw",
    key: Jwk | ArrayBuffer,
    algorithm: string | { name: string; namedCurve?: string },
    extractable: boolean,
    usages: string[],
  ): Promise<CryptoKey>;
  sign(
    algorithm: { name: string; hash: string },
    key: CryptoKey,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer>;
  deriveBits(
    algorithm: { name: string; [option: string]: unknown },
    key: CryptoKey,
    length: number,
  ): Promise<ArrayBuffer>;
  encrypt(
    algorithm: { name: string; iv: ArrayBuffer },
    key: CryptoKey,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer>;
}

const subtle = crypto.subtle as unknown as SubtleLike;

// --- VAPID keys ---

// The subset of a JWK this file reads. `JsonWebKey` itself is a DOM lib type,
// which the node tsconfig doesn't pull in — and declaring only what we use also
// documents the contract (an EC P-256 key pair).
interface Jwk {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
  d?: string;
  ext?: boolean;
  key_ops?: string[];
}

interface VapidKeys {
  publicKey: string;
  privateJwk: Jwk;
}

// Generated once per workspace and persisted: the public key is baked into the
// browser's subscription, so regenerating it would silently orphan every
// existing subscriber.
export async function vapidKeys(store: Store): Promise<VapidKeys> {
  const stored = await store.getSetting(VAPID_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as VapidKeys;
    } catch {
      // unreadable — fall through and mint a fresh pair
    }
  }
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicJwk = await subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await subtle.exportKey("jwk", pair.privateKey);
  const publicKey = b64uEncode(
    concat(new Uint8Array([4]), b64uDecode(publicJwk.x!), b64uDecode(publicJwk.y!)),
  );
  const keys: VapidKeys = { publicKey, privateJwk };
  await store.setSetting(VAPID_KEY, JSON.stringify(keys));
  return keys;
}

async function vapidHeader(endpoint: string, keys: VapidKeys): Promise<string> {
  const audience = new URL(endpoint).origin;
  const header = b64uEncode(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64uEncode(
    utf8(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: VAPID_SUBJECT,
      }),
    ),
  );
  const key = await subtle.importKey(
    "jwk",
    keys.privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, buf(utf8(`${header}.${payload}`))),
  );
  return `vapid t=${header}.${payload}.${b64uEncode(signature)}, k=${keys.publicKey}`;
}

// --- aes128gcm payload encryption (RFC 8291) ---

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", buf(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: buf(salt), info: buf(info) },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

async function encryptPayload(
  subscription: PushSubscription,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const uaPublic = b64uDecode(subscription.keys.p256dh);
  const authSecret = b64uDecode(subscription.keys.auth);

  const ephemeral = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const asPublic = new Uint8Array(await subtle.exportKey("raw", ephemeral.publicKey));
  const uaKey = await subtle.importKey(
    "raw",
    buf(uaPublic),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await subtle.deriveBits({ name: "ECDH", public: uaKey }, ephemeral.privateKey, 256),
  );

  const prk = await hkdf(
    authSecret,
    shared,
    concat(utf8("WebPush: info\0"), uaPublic, asPublic),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, prk, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, prk, utf8("Content-Encoding: nonce\0"), 12);

  const key = await subtle.importKey("raw", buf(cek), "AES-GCM", false, ["encrypt"]);
  // 0x02 is the last-record padding delimiter; a single record carries the
  // whole payload.
  const body = concat(plaintext, new Uint8Array([2]));
  const sealed = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv: buf(nonce) }, key, buf(body)),
  );
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, sealed);
}

// --- subscriptions ---

export async function listSubscriptions(store: Store): Promise<PushSubscription[]> {
  const raw = await store.getSetting(SUBS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PushSubscription[]) : [];
  } catch {
    return [];
  }
}

export function isPushSubscription(value: unknown): value is PushSubscription {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  const keys = s.keys as Record<string, unknown> | undefined;
  return (
    typeof s.endpoint === "string" &&
    s.endpoint.startsWith("https://") &&
    !!keys &&
    typeof keys.p256dh === "string" &&
    typeof keys.auth === "string"
  );
}

export async function addSubscription(store: Store, sub: PushSubscription): Promise<void> {
  const subs = await listSubscriptions(store);
  if (subs.some((s) => s.endpoint === sub.endpoint)) return;
  subs.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
  await store.setSetting(SUBS_KEY, JSON.stringify(subs));
}

async function dropSubscription(store: Store, endpoint: string): Promise<void> {
  const subs = await listSubscriptions(store);
  const left = subs.filter((s) => s.endpoint !== endpoint);
  if (left.length !== subs.length) await store.setSetting(SUBS_KEY, JSON.stringify(left));
}

// --- hooks ---

export async function listHooks(store: Store): Promise<Hook[]> {
  const raw = await store.getSetting(HOOKS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Hook[]) : [];
  } catch {
    return [];
  }
}

export async function addHook(store: Store, hook: Hook): Promise<Hook> {
  const hooks = await listHooks(store);
  hooks.push(hook);
  await store.setSetting(HOOKS_KEY, JSON.stringify(hooks));
  return hook;
}

export async function removeHook(store: Store, id: string): Promise<boolean> {
  const hooks = await listHooks(store);
  const left = hooks.filter((h) => h.id !== id);
  if (left.length === hooks.length) return false;
  await store.setSetting(HOOKS_KEY, JSON.stringify(left));
  return true;
}

// --- delivery ---

// Push + webhooks for one event. Never throws: the caller awaits it only to
// keep the Worker alive long enough to flush, and a dead endpoint must not
// surface as a failed publish.
export async function notify(store: Store, payload: NotifyPayload): Promise<void> {
  await Promise.all([sendPush(store, payload), postHooks(store, payload)]);
}

async function sendPush(store: Store, payload: NotifyPayload): Promise<void> {
  const subs = await listSubscriptions(store);
  if (subs.length === 0) return;
  let keys: VapidKeys;
  try {
    keys = await vapidKeys(store);
  } catch (err) {
    console.warn("[sideshow] push: vapid key unavailable", err);
    return;
  }
  const body = utf8(
    JSON.stringify({
      title: payload.event === "ask" ? `${payload.slug} needs you` : `${payload.slug} updated`,
      body: payload.text.slice(0, 300),
      url: payload.url,
      event: payload.event,
    }),
  );
  await Promise.all(
    subs.map(async (sub) => {
      try {
        const encrypted = await encryptPayload(sub, body);
        const res = await fetch(sub.endpoint, {
          method: "POST",
          headers: {
            Authorization: await vapidHeader(sub.endpoint, keys),
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: "86400",
          },
          body: buf(encrypted),
        });
        // 404/410 mean the browser dropped the subscription — stop retrying it.
        if (res.status === 404 || res.status === 410) await dropSubscription(store, sub.endpoint);
        else if (!res.ok) console.warn(`[sideshow] push rejected (${res.status})`);
      } catch (err) {
        console.warn("[sideshow] push failed", err);
      }
    }),
  );
}

async function postHooks(store: Store, payload: NotifyPayload): Promise<void> {
  const hooks = (await listHooks(store)).filter((h) => h.events.includes(payload.event));
  await Promise.all(
    hooks.map(async (hook) => {
      try {
        await fetch(hook.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        console.warn("[sideshow] hook failed", err);
      }
    }),
  );
}
