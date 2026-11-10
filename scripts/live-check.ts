// Real-execution check: summarises ONE fixture transcript with the real Claude API,
// runs verification and prints the notes, rejected items and timing.
// Costs a small amount of Anthropic credit. Never prints a fake result:
// without ANTHROPIC_API_KEY it exits with code 2.
//
//   npm run live-check            (reads .env if present)
import { readFileSync } from "node:fs";
import { loadConfig } from "../src/config.ts";
import { ClaudeClient } from "../src/claude.ts";
import { ClaudeMeetingAI } from "../src/ai.ts";
import { numbered, parseTranscript } from "../src/transcript.ts";
import { verifyNotes } from "../src/verify.ts";

const FIXTURE = new URL("../test/fixtures/product-sync.txt", import.meta.url);
const MEETING = { title: "Product sync", date: "2026-11-09", attendees: ["Sarah Khan", "Daniel", "Ayesha"] };

const config = loadConfig();
if (!config.ANTHROPIC_API_KEY) {
  console.error("live-check needs a real Claude API key: set ANTHROPIC_API_KEY (in the environment or .env). Nothing was run.");
  process.exit(2);
}

const ai = new ClaudeMeetingAI(new ClaudeClient({ apiKey: config.ANTHROPIC_API_KEY, model: config.CLAUDE_MODEL, fallbacks: config.CLAUDE_FALLBACKS, timeoutMs: 300_000 }));
const transcript = parseTranscript(readFileSync(FIXTURE, "utf8"));
console.log(`Model: ${config.CLAUDE_MODEL} · fixture: test/fixtures/product-sync.txt (${transcript.lines.length} lines, speakers: ${transcript.speakers.join(", ")})`);

const started = performance.now();
try {
  const raw = await ai.notes(numbered(transcript), MEETING);
  const notesMs = performance.now() - started;
  const notes = verifyNotes(raw, transcript, MEETING.attendees, MEETING.date);

  console.log(`\nSummary:\n  ${notes.summary}`);
  console.log(`\nDecisions (${notes.decisions.length}):`);
  for (const d of notes.decisions) console.log(`  - ${d.decision}  [L${d.line}: "${d.quote}"]`);
  console.log(`\nAction items (${notes.actionItems.length}):`);
  for (const a of notes.actionItems) {
    const due = a.deadline ? `${a.deadline}${a.dueDate ? ` → ${a.dueDate}` : ""}` : "no deadline";
    console.log(`  - ${a.task} | owner: ${a.owner ?? "unassigned"} | ${due} | L${a.line}${a.notes.length ? ` | ${a.notes.join(" ")}` : ""}`);
  }
  if (notes.openQuestions.length) console.log(`\nOpen questions:\n${notes.openQuestions.map((q) => `  - ${q}`).join("\n")}`);
  console.log(`\nRejected by verification (${notes.rejected.length}):`);
  for (const r of notes.rejected) console.log(`  - ${r.kind}: ${r.text} — ${r.reason}`);
  if (!notes.rejected.length) console.log("  (none)");
  console.log(`\nTiming: Claude notes call ${(notesMs / 1000).toFixed(1)} s, verification ${(performance.now() - started - notesMs).toFixed(0)} ms`);
} catch (err) {
  const e = err as Error & { code?: string; status?: number };
  console.error(`live-check failed after ${((performance.now() - started) / 1000).toFixed(1)} s: ${e.code ? `${e.code} (${e.status}) ` : ""}${e.message}`);
  process.exit(1);
}
