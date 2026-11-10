import { test } from "node:test";
import assert from "node:assert/strict";
import { startApp, StubSTT, transcriptFixture } from "./helpers.ts";

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
