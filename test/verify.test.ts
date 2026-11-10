import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTranscript } from "../src/transcript.ts";
import { verifyDeadline, verifyNotes, verifyOwner } from "../src/verify.ts";
import { productSyncNotes, transcriptFixture } from "./helpers.ts";

const t = parseTranscript(transcriptFixture("product-sync.txt"));

test("unsupported decisions and action items are removed, with reasons", () => {
  const v = verifyNotes(productSyncNotes(), t);
  assert.deepEqual(v.decisions.map((d) => d.decision), ["Ship the export fix as a hotfix"]);
  assert.deepEqual(
    v.rejected.map((r) => `${r.kind}:${r.text}`),
    ["decision:Translate onboarding emails into German", "action_item:Book the offsite venue"],
  );
});

test("owners and deadlines are kept only when stated", () => {
  const v = verifyNotes(productSyncNotes(), t);
  const byTask = Object.fromEntries(v.actionItems.map((a) => [a.task, a]));
  assert.equal(byTask["Fix the CSV export bug"].owner, "Daniel");
  assert.equal(byTask["Fix the CSV export bug"].deadline, "Thursday");
  assert.equal(byTask["Send onboarding drafts to the team for comments"].owner, "Ayesha");
  assert.equal(byTask["Send onboarding drafts to the team for comments"].deadline, "by Monday");
  const legal = byTask["Check legal wording on trial terms"];
  assert.equal(legal.owner, null, "Sarah never took the legal review");
  assert.equal(legal.deadline, null, "'next Friday' was never said");
  assert.equal(legal.notes.length, 2);
});

test("a wrong line number is corrected when the quote is nearby, and duplicates are merged", () => {
  const v = verifyNotes(productSyncNotes(), t);
  const status = v.actionItems.find((a) => a.task.startsWith("Update the status page"))!;
  assert.equal(status.line, 11);
  assert.equal(v.actionItems.filter((a) => a.task === "Fix the CSV export bug").length, 1);
  assert.equal(v.actionItems.length, 4);
});

test("verifyOwner: commitments by the speaker, names in the cited or previous line, nothing else", () => {
  assert.equal(verifyOwner(t, 2, "Daniel Smith"), "Daniel", "speaker's first-person commitment, first name resolved");
  assert.equal(verifyOwner(t, 11, "Daniel"), "Daniel", "named in the cited line ('Daniel, can you…')");
  assert.equal(verifyOwner(t, 12, "Daniel"), "Daniel", "'Sure, will do' after being asked by name");
  assert.equal(verifyOwner(t, 2, "Ayesha"), null, "merely speaking nearby is not ownership");
  assert.equal(verifyOwner(t, 6, "Sarah Khan"), null, "'we still need someone' has no owner");
  assert.equal(verifyOwner(t, 2, "I"), null);
  assert.equal(verifyOwner(t, 2, "the team"), null);
  assert.equal(verifyOwner(t, 11, "Priya"), null);
  const ext = parseTranscript("Sarah: Let's ask Priya from finance to approve the budget.");
  assert.equal(verifyOwner(ext, 1, "Priya"), "Priya", "non-attendee named in the line");
  const statement = parseTranscript("Tom: I think the budget is too high.");
  assert.equal(verifyOwner(statement, 1, "Tom"), null, "an opinion is not a commitment");
});

test("verifyDeadline requires the words to be in context", () => {
  assert.equal(verifyDeadline(t, 2, "Thursday"), "Thursday");
  assert.equal(verifyDeadline(t, 2, "2026-11-12"), null);
  assert.equal(verifyDeadline(t, 2, null), null);
});

test("a meeting with no decisions yields empty lists", () => {
  const v = verifyNotes({ summary: "Ideas only.", key_points: [], decisions: [], action_items: [], open_questions: [] }, parseTranscript(transcriptFixture("brainstorm.srt")));
  assert.deepEqual([v.decisions, v.actionItems, v.rejected], [[], [], []]);
});
