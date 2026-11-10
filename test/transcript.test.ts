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
