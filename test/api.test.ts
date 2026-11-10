import { test } from "node:test";
import assert from "node:assert/strict";
import { startApp, StubSTT, transcriptFixture } from "./helpers.ts";
import { DeepgramSTT } from "../src/stt.ts";

const KEY = "meet-key";
const H = { "x-api-key": KEY };

test("JSON create → list → detail → markdown/JSON export", async () => {
  const app = await startApp({ apiKey: KEY });
  try {
    const res = await fetch(`${app.base}/api/meetings`, {
      method: "POST",
      headers: { ...H, "content-type": "application/json" },
      body: JSON.stringify({ title: "Product sync", date: "2026-11-09", attendees: ["Sarah Khan", "Daniel", "Ayesha"], transcript: transcriptFixture("product-sync.txt") }),
    });
    assert.equal(res.status, 201);
    const { meeting } = (await res.json()) as any;
    assert.equal("transcript" in meeting, false);
    assert.equal(meeting.lineCount, 12);

    const list = (await (await fetch(`${app.base}/api/meetings`, { headers: H })).json()) as any;
    assert.equal(list.meetings[0].decisions, 1);
    const md = await fetch(`${app.base}/api/meetings/${meeting.id}/export.md`, { headers: H });
    assert.match(md.headers.get("content-type")!, /text\/markdown/);
    assert.match(md.headers.get("content-disposition")!, /meeting-2026-11-09\.md/);
    assert.match(await md.text(), /# Product sync/);
    const json = (await (await fetch(`${app.base}/api/meetings/${meeting.id}/export.json`, { headers: H })).json()) as any;
    assert.equal(json.notes.actionItems.length, 4);
  } finally {
    await app.close();
  }
});

test("raw VTT upload with metadata in the query string (stateless analyze)", async () => {
  const app = await startApp({ apiKey: KEY });
  try {
    const res = await fetch(`${app.base}/api/analyze?title=Standup&attendees=Priya,Tom&followUp=false`, {
      method: "POST",
      headers: { ...H, "content-type": "text/vtt" },
      body: transcriptFixture("standup.vtt"),
    });
    assert.equal(res.status, 200);
    const out = (await res.json()) as any;
    assert.equal(out.format, "vtt");
    assert.deepEqual(out.speakers, ["Priya", "Tom"]);
    assert.equal(out.followUp, null);
    assert.match(out.markdown, /# Standup/);
    assert.equal(app.store.list(5).length, 0, "analyze stores nothing");
  } finally {
    await app.close();
  }
});

test("validation and errors", async () => {
  const app = await startApp({ apiKey: KEY, ai: null });
  try {
    assert.equal((await fetch(`${app.base}/api/meetings`, { headers: {} })).status, 401);
    const short = await fetch(`${app.base}/api/meetings`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ transcript: "hi" }) });
    assert.equal(short.status, 400);
    const badDate = await fetch(`${app.base}/api/meetings`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ transcript: transcriptFixture("standup.vtt"), date: "09/11/2026" }) });
    assert.equal(badDate.status, 400);
    const noAi = await fetch(`${app.base}/api/analyze`, { method: "POST", headers: { ...H, "content-type": "text/plain" }, body: transcriptFixture("product-sync.txt") });
    assert.equal(noAi.status, 503);
    const audio = await fetch(`${app.base}/api/transcribe`, { method: "POST", headers: { ...H, "content-type": "audio/wav" }, body: "RIFF" });
    assert.equal(audio.status, 503);
    const wrongType = await fetch(`${app.base}/api/transcribe`, { method: "POST", headers: { ...H, "content-type": "image/png" }, body: "x" });
    assert.equal(wrongType.status, 415);
    assert.equal((await fetch(`${app.base}/api/meetings/missing`, { headers: H })).status, 404);
    const health = (await (await fetch(`${app.base}/health`)).json()) as any;
    assert.deepEqual(health.integrations, { claude: false, speechToText: false });
  } finally {
    await app.close();
  }
});

test("transcribe returns a transcript when STT is configured", async () => {
  const app = await startApp({ apiKey: KEY, stt: new StubSTT() });
  try {
    const res = await fetch(`${app.base}/api/transcribe`, { method: "POST", headers: { ...H, "content-type": "audio/mpeg" }, body: new Uint8Array([1, 2, 3, 4]) });
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as any).transcript, "Speaker 1: received 4 bytes");
  } finally {
    await app.close();
  }
});

const json = (body: unknown) => ({ method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify(body) });

test("raw upload: empty query values (?date=&title=) count as absent, not 400", async () => {
  const app = await startApp({ apiKey: KEY });
  try {
    const res = await fetch(`${app.base}/api/meetings?date=&title=&attendees=`, { method: "POST", headers: { ...H, "content-type": "text/plain" }, body: transcriptFixture("product-sync.txt") });
    assert.equal(res.status, 201);
    const { meeting } = (await res.json()) as any;
    assert.deepEqual([meeting.date, meeting.title, meeting.attendees], [null, null, []]);
  } finally {
    await app.close();
  }
});

test("Idempotency-Key: a retried POST returns the stored meeting instead of a duplicate", async () => {
  const app = await startApp({ apiKey: KEY });
  try {
    const body = { title: "Product sync", transcript: transcriptFixture("product-sync.txt") };
    const withKey = (key: string) => ({ ...json(body), headers: { ...json(body).headers, "idempotency-key": key } });
    const first = await fetch(`${app.base}/api/meetings`, withKey("n8n-exec-42"));
    assert.equal(first.status, 201);
    const again = await fetch(`${app.base}/api/meetings`, withKey("n8n-exec-42"));
    assert.equal(again.status, 200);
    assert.equal(again.headers.get("idempotent-replayed"), "true");
    assert.equal(((await again.json()) as any).meeting.id, ((await first.json()) as any).meeting.id);
    assert.equal(app.ai!.received.length, 1);
    assert.equal(app.store.list(10).length, 1);
    assert.equal((await fetch(`${app.base}/api/meetings`, withKey("has space"))).status, 400);
  } finally {
    await app.close();
  }
});

/** Deepgram stand-in at the fetch level, so the real DeepgramSTT client is exercised. */
function deepgramFetch(reply: () => Response) {
  const calls: { url: string; bytes: number }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), bytes: (init!.body as Uint8Array).length });
    return reply();
  }) as typeof fetch;
  return { calls, impl };
}

const productSyncUtterances = () =>
  Response.json({
    metadata: { duration: 60 },
    results: {
      utterances: transcriptFixture("product-sync.txt")
        .trim()
        .split(/\r?\n/)
        .map((l) => ({ speaker: 0, transcript: l.slice(l.indexOf(":") + 1).trim() })),
    },
  });

test("POST /api/meetings/audio: transcribes, then summarises, verifies and stores", async () => {
  const dg = deepgramFetch(productSyncUtterances);
  const app = await startApp({ apiKey: KEY, stt: new DeepgramSTT("dg-test", { fetchImpl: dg.impl }) });
  try {
    const res = await fetch(`${app.base}/api/meetings/audio?title=Product%20sync&date=2026-11-09&followUp=false`, {
      method: "POST",
      headers: { ...H, "content-type": "audio/mpeg" },
      body: new Uint8Array([1, 2, 3, 4, 5]),
    });
    assert.equal(res.status, 201);
    const { meeting } = (await res.json()) as any;
    assert.equal(dg.calls.length, 1);
    assert.equal(dg.calls[0].bytes, 5);
    assert.deepEqual([meeting.title, meeting.date, meeting.speakers], ["Product sync", "2026-11-09", ["Speaker 1"]]);
    assert.match(app.ai!.received[0], /^\[L1\] Speaker 1: Thanks for joining/);
    assert.ok(meeting.notes.decisions.length >= 1, "verification ran on the STT transcript");
    assert.equal(app.store.list(5).length, 1);
  } finally {
    await app.close();
  }
});

test("POST /api/meetings/audio: 503 without STT, 400 bad metadata before transcribing, 502 on a non-JSON Deepgram reply", async () => {
  const off = await startApp({ apiKey: KEY });
  try {
    const res = await fetch(`${off.base}/api/meetings/audio`, { method: "POST", headers: { ...H, "content-type": "audio/wav" }, body: "RIFF" });
    assert.equal(res.status, 503);
    assert.match(((await res.json()) as any).error.message, /DEEPGRAM_API_KEY/);
  } finally {
    await off.close();
  }

  const dg = deepgramFetch(() => new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } }));
  const app = await startApp({ apiKey: KEY, stt: new DeepgramSTT("dg-test", { fetchImpl: dg.impl }) });
  try {
    const post = (q: string, type = "audio/wav") => fetch(`${app.base}/api/meetings/audio${q}`, { method: "POST", headers: { ...H, "content-type": type }, body: "RIFF" });
    assert.equal((await post("?date=09/11/2026")).status, 400);
    assert.equal((await post("", "text/plain")).status, 415);
    assert.equal(dg.calls.length, 0, "nothing was sent to Deepgram for invalid requests");
    const bad = await post("");
    assert.equal(bad.status, 502);
    assert.equal(((await bad.json()) as any).error.code, "stt_invalid_response");
    assert.equal(app.store.list(5).length, 0);
  } finally {
    await app.close();
  }
});

test("TRUST_PROXY is passed through to the router's rate limiter", async () => {
  for (const trustProxy of [false, true]) {
    const app = await startApp({ apiKey: KEY, trustProxy, rateLimitPerMinute: 1 });
    try {
      const get = (ip: string) => fetch(`${app.base}/api/meetings`, { headers: { ...H, "x-forwarded-for": ip } });
      assert.equal((await get("1.1.1.1")).status, 200);
      assert.equal((await get("2.2.2.2")).status, trustProxy ? 200 : 429);
    } finally {
      await app.close();
    }
  }
});
