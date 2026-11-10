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

test("verifyDeadline matches whole words only, case-insensitively", () => {
  const money = parseTranscript("Ali: We need more money for the launch.\nSara: I'll send the budget.");
  assert.equal(verifyDeadline(money, 2, "Mon"), null, "'Mon' is not in 'money'");
  const may = parseTranscript("Ali: You may want to check the numbers.\nSara: I'll check them.");
  assert.equal(verifyDeadline(may, 2, "May"), null, "the verb 'may' is not the month");
  const real = parseTranscript("Ali: Can you send it by MAY 3?\nSara: Yes, I'll send it.");
  assert.equal(verifyDeadline(real, 2, "May 3"), "May 3");
  const month = parseTranscript("Ali: Let's launch it in May.\nSara: I'll prepare the launch.");
  assert.equal(verifyDeadline(month, 2, "May"), "May", "capitalised month in context");
  assert.equal(verifyDeadline(t, 8, "by monday"), "by monday");
  assert.equal(verifyDeadline(t, 2, "thurs"), null, "partial word");
});

test("decision/task text must share key words with the cited line", () => {
  const notes = {
    summary: "s",
    key_points: [],
    decisions: [
      // Real quote, invented decision.
      { decision: "Double the marketing budget for Q3", evidence_line: 3, evidence_quote: "we ship the fix as a hotfix" },
      { decision: "Release the export fix as a hotfix", evidence_line: 3, evidence_quote: "we ship the fix as a hotfix" },
    ],
    action_items: [
      { task: "Hire two contractors", owner: null, deadline: null, evidence_line: 8, evidence_quote: "send the drafts to the team" },
      // Paraphrase: "draft" ~ "drafts", "comment" ~ "comments".
      { task: "Share draft emails for comment", owner: "Ayesha", deadline: "by Monday", evidence_line: 8, evidence_quote: "send the drafts to the team" },
    ],
    open_questions: [],
  };
  const v = verifyNotes(notes, t);
  assert.deepEqual(v.decisions.map((d) => d.decision), ["Release the export fix as a hotfix"]);
  assert.deepEqual(v.actionItems.map((a) => a.task), ["Share draft emails for comment"]);
  assert.deepEqual(v.rejected.map((r) => r.text), ["Double the marketing budget for Q3", "Hire two contractors"]);
  assert.match(v.rejected[0].reason, /no key words/);
});

test("quotes shorter than the minimum are rejected", () => {
  const notes = {
    summary: "s",
    key_points: [],
    decisions: [{ decision: "Hotfix it", evidence_line: 5, evidence_quote: "hotfix" }],
    action_items: [{ task: "Update status page", owner: null, deadline: null, evidence_line: 12, evidence_quote: "will do" }],
    open_questions: [],
  };
  const v = verifyNotes(notes, t);
  assert.equal(v.decisions.length + v.actionItems.length, 0);
  assert.equal(v.rejected.length, 2);
});

test("due dates are resolved in code from verified deadlines and the meeting date", () => {
  const v = verifyNotes(productSyncNotes(), t, [], "2026-11-09");
  const byTask = Object.fromEntries(v.actionItems.map((a) => [a.task, a]));
  assert.equal(byTask["Fix the CSV export bug"].deadline, "Thursday", "spoken text is kept");
  assert.equal(byTask["Fix the CSV export bug"].dueDate, "2026-11-12");
  assert.equal(byTask["Send onboarding drafts to the team for comments"].dueDate, "2026-11-09");
  assert.equal(byTask["Check legal wording on trial terms"].dueDate, null, "removed deadline → no due date");
  assert.ok(verifyNotes(productSyncNotes(), t).actionItems.every((a) => a.dueDate === null), "no meeting date → null");
});
