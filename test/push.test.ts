import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  addHook,
  addSubscription,
  isPushSubscription,
  listHooks,
  listSubscriptions,
  notify,
  type NotifyPayload,
  type PushSubscription,
  removeHook,
  vapidKeys,
} from "../server/push.ts";
import { createSqliteStorage } from "../server/sqliteStorage.ts";
import { SqlStore } from "../server/sqlStore.ts";
import type { Store } from "../server/types.ts";

// Web Push and webhooks: keys, subscription bookkeeping, and — above all — that
// a dead endpoint can never fail the write that triggered it.

const store = () => new SqlStore(createSqliteStorage()) as Store;

const b64u = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// A subscription with a real P-256 public key, so the aes128gcm encryption path
// runs for real instead of being stubbed.
async function subscribe(endpoint = "https://push.example/endpoint"): Promise<PushSubscription> {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    endpoint,
    keys: { p256dh: b64u(raw), auth: b64u(crypto.getRandomValues(new Uint8Array(16))) },
  };
}

const payload = (event: NotifyPayload["event"] = "ask"): NotifyPayload => ({
  event,
  project: "acme/site",
  slug: "pricing-card",
  variant: "highlighted",
  version: 3,
  text: "tighter or roomier?",
  url: "https://mockpit.example/project/acme%2Fsite/pricing-card",
});

const realFetch = globalThis.fetch;
const realWarn = console.warn;
afterEach(() => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
});

// Capture the requests notify() makes instead of hitting the network.
function captureFetch(respond: (url: string) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (input: any, init: any) => {
    calls.push({ url: String(input), init: init ?? {} });
    return respond(String(input));
  }) as typeof fetch;
  return calls;
}

test("VAPID keys are minted once and reused", async () => {
  const s = store();
  const first = await vapidKeys(s);
  assert.match(first.publicKey, /^[A-Za-z0-9_-]{80,}$/);
  assert.equal(first.privateJwk.crv, "P-256");
  assert.equal((await vapidKeys(s)).publicKey, first.publicKey, "regenerating orphans subscribers");

  // an unreadable stored pair is replaced rather than thrown
  await s.setSetting("push:vapid", "{not json");
  const fresh = await vapidKeys(s);
  assert.notEqual(fresh.publicKey, first.publicKey);
});

test("isPushSubscription accepts only an https endpoint with both keys", async () => {
  const good = await subscribe();
  assert.equal(isPushSubscription(good), true);
  assert.equal(isPushSubscription({ ...good, endpoint: "http://push.example/e" }), false);
  assert.equal(isPushSubscription({ ...good, keys: { p256dh: "x" } }), false);
  assert.equal(isPushSubscription({ endpoint: "https://push.example/e" }), false);
  assert.equal(isPushSubscription(null), false);
  assert.equal(isPushSubscription("nope"), false);
});

test("subscriptions dedupe by endpoint and survive an unreadable setting", async () => {
  const s = store();
  const sub = await subscribe();
  await addSubscription(s, sub);
  await addSubscription(s, { ...sub, keys: { ...sub.keys } });
  assert.equal((await listSubscriptions(s)).length, 1);

  await s.setSetting("push:subs", "{not json");
  assert.deepEqual(await listSubscriptions(s), []);
  await s.setSetting("push:subs", JSON.stringify({ not: "an array" }));
  assert.deepEqual(await listSubscriptions(s), []);
});

test("hooks are added, listed, and removed by id", async () => {
  const s = store();
  await addHook(s, { id: "h1", url: "https://loom.example/hook", events: ["ask"] });
  await addHook(s, { id: "h2", url: "https://loom.example/other", events: ["publish"] });
  assert.deepEqual(
    (await listHooks(s)).map((h) => h.id),
    ["h1", "h2"],
  );
  assert.equal(await removeHook(s, "h1"), true);
  assert.equal(await removeHook(s, "h1"), false);
  assert.deepEqual(
    (await listHooks(s)).map((h) => h.id),
    ["h2"],
  );

  await s.setSetting("hooks", "{not json");
  assert.deepEqual(await listHooks(s), []);
});

test("notify encrypts one push per subscription and posts matching hooks only", async () => {
  const s = store();
  await addSubscription(s, await subscribe("https://push.example/a"));
  await addSubscription(s, await subscribe("https://push.example/b"));
  await addHook(s, { id: "h1", url: "https://loom.example/ask", events: ["ask", "decision"] });
  await addHook(s, { id: "h2", url: "https://loom.example/publish", events: ["publish"] });

  const calls = captureFetch(() => new Response(null, { status: 201 }));
  await notify(s, payload("ask"));

  const pushes = calls.filter((c) => c.url.startsWith("https://push.example/"));
  assert.equal(pushes.length, 2);
  for (const push of pushes) {
    const headers = push.init.headers as Record<string, string>;
    assert.match(headers.Authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    assert.equal(headers["Content-Encoding"], "aes128gcm");
    assert.equal(headers["Content-Type"], "application/octet-stream");
    // the ciphertext carries the RFC 8291 header: 16-byte salt, record size,
    // and the ephemeral public key
    const body = new Uint8Array(push.init.body as ArrayBuffer);
    assert.ok(body.byteLength > 21);
    assert.equal(body[20], 65, "uncompressed P-256 key length");
  }

  const hooks = calls.filter((c) => c.url.startsWith("https://loom.example/"));
  assert.deepEqual(
    hooks.map((h) => h.url),
    ["https://loom.example/ask"],
  );
  assert.deepEqual(JSON.parse(hooks[0].init.body as string), payload("ask"));
});

test("notify drops a gone subscription and survives every failure", async () => {
  const s = store();
  await addSubscription(s, await subscribe("https://push.example/gone"));
  await addSubscription(s, await subscribe("https://push.example/rejects"));
  await addSubscription(s, await subscribe("https://push.example/throws"));
  await addHook(s, { id: "h1", url: "https://loom.example/down", events: ["publish"] });
  console.warn = () => {};

  captureFetch((url) => {
    if (url.endsWith("/gone")) return new Response(null, { status: 410 });
    if (url.endsWith("/rejects")) return new Response(null, { status: 500 });
    return Promise.reject(new Error("network down"));
  });
  // Never throws: a publish must not fail because a push endpoint is down.
  await notify(s, payload("publish"));

  assert.deepEqual(
    (await listSubscriptions(s)).map((sub) => sub.endpoint),
    ["https://push.example/rejects", "https://push.example/throws"],
    "only the 410 endpoint is forgotten",
  );
});

test("notify does nothing without subscribers or hooks", async () => {
  const s = store();
  const calls = captureFetch(() => new Response(null, { status: 201 }));
  await notify(s, payload("decision"));
  assert.deepEqual(calls, []);
  // and no VAPID key pair is minted for nobody
  assert.equal(await s.getSetting("push:vapid"), null);
});
