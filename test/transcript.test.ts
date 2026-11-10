import { test } from "node:test";
import assert from "node:assert/strict";
import { detectFormat, normalize, numbered, parseTranscript } from "../src/transcript.ts";
import { transcriptFixture } from "./helpers.ts";

test("plain-text transcripts: speakers, numbering and continuation lines", () => {
  const t = parseTranscript(transcriptFixture("product-sync.txt"));
  assert.equal(t.format, "text");
  assert.equal(t.lines.length, 12);
  assert.deepEqual(t.speakers, ["Sarah Khan", "Daniel", "Ayesha"]);
  assert.equal(t.lines[1].speaker, "Daniel");
  const cont = parseTranscript("Sarah: First point.\nand a continuation of it\nTom: Next.");
  assert.equal(cont.lines[1].speaker, "Sarah");
  assert.match(numbered(t).split("\n")[1], /^\[L2\] Daniel: The export bug/);
});

test("WebVTT with <v> voice tags and NOTE blocks", () => {
  const t = parseTranscript(transcriptFixture("standup.vtt"));
  assert.equal(t.format, "vtt");
  assert.equal(t.lines.length, 5);
  assert.deepEqual(t.speakers, ["Priya", "Tom"]);
  assert.equal(t.lines[2].time, "00:00:11.300");
  assert.match(numbered(t), /\[L3\] \(00:00:11\.300\) Priya: Tom, I'll share/);
});

test("SRT with 'Speaker N:' labels", () => {
  const t = parseTranscript(transcriptFixture("brainstorm.srt"));
  assert.equal(t.format, "srt");
  assert.deepEqual(t.speakers, ["Speaker 1", "Speaker 2"]);
  assert.equal(t.lines[0].time, "00:00:00.500");
});

test("lines without a speaker label are kept with speaker null", () => {
  const t = parseTranscript("we should decide on the budget. it is due next week.");
  assert.equal(t.lines[0].speaker, null);
  assert.equal(detectFormat("hello"), "text");
});

test("sentences with a colon are not mistaken for speakers", () => {
  const t = parseTranscript("Sarah: Agenda is simple: one item.\nThe plan for today is this: nothing.");
  assert.equal(t.lines[0].text, "Agenda is simple: one item.");
  assert.notEqual(t.lines[1].speaker, "The plan for today is this");
});

test("normalize makes quotes comparable", () => {
  assert.equal(normalize("  I’ll   send it — by MONDAY!! "), "i'll send it by monday");
});

test("Teams/Zoom layout: speaker name on its own line (with or without timestamps)", () => {
  const teams = parseTranscript("Sarah Khan   0:03\nThanks for joining.\nDaniel   0:10\nI can have the fix ready by Thursday.\nIt is the date filter.\nSarah Khan   0:15\nOkay\nGreat.");
  assert.deepEqual(teams.speakers, ["Sarah Khan", "Daniel"]);
  assert.deepEqual(teams.lines.map((l) => `${l.speaker}|${l.text}`), [
    "Sarah Khan|Thanks for joining.",
    "Daniel|I can have the fix ready by Thursday.",
    "Daniel|It is the date filter.",
    "Sarah Khan|Okay",
    "Sarah Khan|Great.",
  ]);
  assert.equal(teams.lines[1].time, "0:10");
  const zoom = parseTranscript("[Sarah Khan] 10:02:33\nHello all\n[Daniel] 10:02:40\nHi");
  assert.deepEqual(zoom.lines.map((l) => `${l.speaker}|${l.text}|${l.time}`), ["Sarah Khan|Hello all|10:02:33", "Daniel|Hi|10:02:40"]);
  const bare = parseTranscript("Sarah Khan\nThanks for joining.\nDaniel\nI'll fix it.\nSarah Khan\nAgreed.\nDaniel\nOkay");
  assert.deepEqual(bare.lines.map((l) => `${l.speaker}|${l.text}`), ["Sarah Khan|Thanks for joining.", "Daniel|I'll fix it.", "Sarah Khan|Agreed.", "Daniel|Okay"]);
  // Ordinary prose with short Title-Case lines is not reinterpreted.
  const prose = parseTranscript("Budget\nWe should decide on the budget.\nTimeline\nIt is due next week.");
  assert.ok(prose.lines.every((l) => l.speaker === null));
});

test("a VTT cue with several <v> voices is split per speaker", () => {
  const t = parseTranscript("WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\n<v Tom>Hi there.</v> <v Priya>Hello Tom.</v>\n\n2\n00:00:03.000 --> 00:00:05.000\n<v.loud Tom>First</v>\n<v Priya>Second");
  assert.deepEqual(t.lines.map((l) => `${l.speaker}|${l.text}|${l.time}`), [
    "Tom|Hi there.|00:00:01.000",
    "Priya|Hello Tom.|00:00:01.000",
    "Tom|First|00:00:03.000",
    "Priya|Second|00:00:03.000",
  ]);
});
