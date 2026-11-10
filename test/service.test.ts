import { test } from "node:test";
import assert from "node:assert/strict";
import { makeService, StubSTT, transcriptFixture } from "./helpers.ts";
import { toMarkdown } from "../src/export.ts";
import { MeetingStore } from "../src/store.ts";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("create: parses, sends numbered lines to the AI, verifies, drafts follow-up from verified notes only", async () => {
  const { service, ai, store } = makeService();
  const m = await service.create({ title: "Product sync", date: "2026-11-09", transcript: transcriptFixture("product-sync.txt") }, { followUp: true });
  assert.match(ai!.received[0], /^\[L1\] Sarah Khan: Thanks for joining/);
  assert.equal(m.notes.decisions.length, 1);
  assert.equal(m.notes.rejected.length, 2);
  assert.ok(ai!.followUpInput, "follow-up was generated");
  assert.ok(!ai!.followUpInput!.actionItems.some((a) => a.task === "Book the offsite venue"), "hallucinated item never reaches the email");
  assert.match(m.followUp!.body, /Check legal wording on trial terms \(Owner: TBD\)/);
  assert.equal(store.list(10)[0].actionItems, 4);
});

test("followUp=false skips the email draft", async () => {
  const { service, ai } = makeService();
  const m = await service.create({ transcript: transcriptFixture("product-sync.txt") }, { followUp: false });
  assert.equal(m.followUp, null);
  assert.equal(ai!.followUpInput, undefined);
});

test("errors: no Claude, too many lines, AI failure", async () => {
  const none = makeService({ ai: null });
  await assert.rejects(none.service.summarize({ transcript: transcriptFixture("standup.vtt") }, { followUp: true }), (e: Error & { code?: string }) => e.code === "ai_not_configured");
  const { service, ai } = makeService();
  const long = Array.from({ length: 501 }, (_, i) => `A: line ${i}`).join("\n");
  await assert.rejects(service.summarize({ transcript: long }, { followUp: false }), (e: Error & { code?: string }) => e.code === "transcript_too_long");
  ai!.fail = new Error("Claude API rate limit reached");
  await assert.rejects(service.create({ transcript: transcriptFixture("product-sync.txt") }, { followUp: true }), /rate limit/);
});

test("speech-to-text is optional: 503 without a provider, works with one", async () => {
  const off = makeService();
  await assert.rejects(off.service.transcribe(Buffer.from("x"), "audio/wav"), (e: Error & { code?: string }) => e.code === "stt_not_configured");
  const on = makeService({ stt: new StubSTT() });
  assert.equal((await on.service.transcribe(Buffer.from("abc"), "audio/wav")).transcript, "Speaker 1: received 3 bytes");
  await assert.rejects(on.service.transcribe(Buffer.alloc(0), "audio/wav"), (e: Error & { code?: string }) => e.code === "empty_file");
});

test("markdown export: decisions with sources, unassigned owners, removed items, escaping", async () => {
  const { service } = makeService();
  const m = await service.create({ title: "Sync *v2*", transcript: transcriptFixture("product-sync.txt") }, { followUp: true });
  const md = toMarkdown(m, m.notes, m.followUp);
  assert.match(md, /^# Sync \\\*v2\\\*/);
  assert.match(md, /- Ship the export fix as a hotfix _\(L3: "we ship the fix as a hotfix"\)_/);
  assert.match(md, /\| Check legal wording on trial terms \| _Unassigned_ \| — \| L6 \|/);
  assert.match(md, /\| Fix the CSV export bug \| Daniel \| Thursday \| L2 \|/);
  assert.match(md, /## Removed during verification[\s\S]*Book the offsite venue — Cited quote not found/);
  assert.match(md, /## Follow-up email draft/);
  const empty = toMarkdown({ title: null, date: null, attendees: [], speakers: [] }, { summary: "x", keyPoints: [], decisions: [], actionItems: [], openQuestions: [], rejected: [] }, null);
  assert.match(empty, /_No decisions were recorded\._/);
  assert.match(empty, /_No action items were recorded\._/);
});

test("no follow-up AI call when there is nothing to follow up on", async () => {
  const { service, ai } = makeService();
  ai!.notesToReturn = { summary: "Ideas only, nothing decided.", key_points: ["Chatbot idea"], decisions: [], action_items: [], open_questions: [] };
  const m = await service.create({ transcript: transcriptFixture("brainstorm.srt") }, { followUp: true });
  assert.equal(m.followUp, null);
  assert.equal(ai!.followUpCalls, 0, "only the notes call was made");
  ai!.notesToReturn = { ...ai!.notesToReturn, open_questions: ["Do we have data on pricing-page chats?"] };
  await service.create({ transcript: transcriptFixture("brainstorm.srt") }, { followUp: true });
  assert.equal(ai!.followUpCalls, 1, "open questions are worth a follow-up");
});

test("due dates reach the stored notes, the follow-up input and the Markdown export", async () => {
  const { service, ai } = makeService();
  const m = await service.create({ date: "2026-11-09", transcript: transcriptFixture("product-sync.txt") }, { followUp: true });
  const fix = m.notes.actionItems.find((a) => a.task === "Fix the CSV export bug")!;
  assert.deepEqual([fix.deadline, fix.dueDate], ["Thursday", "2026-11-12"]);
  assert.equal(ai!.followUpInput!.actionItems.find((a) => a.task === fix.task)!.dueDate, "2026-11-12");
  assert.match(toMarkdown(m, m.notes, m.followUp), /\| Fix the CSV export bug \| Daniel \| Thursday \(2026-11-12\) \| L2 \|/);
});

test("idempotency key: a repeat (sequential or concurrent) returns the stored meeting without new AI calls", async () => {
  const { service, ai, store } = makeService();
  const input = { transcript: transcriptFixture("product-sync.txt") };
  const [a, b] = await Promise.all([service.createIdempotent(input, { followUp: false }, "drive-file-1"), service.createIdempotent(input, { followUp: false }, "drive-file-1")]);
  assert.equal(a.meeting.id, b.meeting.id);
  assert.deepEqual([a.replayed, b.replayed], [false, true]);
  const c = await service.createIdempotent(input, { followUp: false }, "drive-file-1");
  assert.equal(c.meeting.id, a.meeting.id);
  assert.equal(c.replayed, true);
  assert.equal(ai!.received.length, 1, "Claude was called once");
  assert.equal(store.list(10).length, 1);
  await assert.rejects(
    service.createIdempotent({ transcript: transcriptFixture("standup.vtt") }, { followUp: false }, "drive-file-1"),
    (e: Error & { code?: string }) => e.code === "idempotency_key_reused",
  );
  await service.createIdempotent(input, { followUp: false });
  assert.equal(store.list(10).length, 2, "no key → no deduplication");
});

test("store migrates an existing database without the idempotency column", () => {
  const dir = mkdtempSync(join(tmpdir(), "meet-"));
  try {
    const path = join(dir, "old.db");
    const old = new DatabaseSync(path);
    old.exec("CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL)");
    old.close();
    const store = new MeetingStore(path);
    assert.equal(store.getByIdempotencyKey("x"), undefined);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
