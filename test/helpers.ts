// Test doubles: a scripted "Claude" that returns notes for the product-sync fixture,
// including deliberately unsupported items that verification must remove.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import type { MeetingAI, MeetingMeta } from "../src/ai.ts";
import type { SpeechToText } from "../src/stt.ts";
import type { FollowUp, Notes, VerifiedNotes } from "../src/schemas.ts";
import { MeetingStore } from "../src/store.ts";
import { MeetingService } from "../src/service.ts";
import { createRouter } from "../src/app.ts";

export const transcriptFixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

export const productSyncNotes = (): Notes => ({
  summary: "The team discussed a CSV export bug and the onboarding email sequence.",
  key_points: ["Export bug is caused by the new date filter", "Three onboarding emails drafted"],
  decisions: [
    { decision: "Ship the export fix as a hotfix", evidence_line: 3, evidence_quote: "we ship the fix as a hotfix" },
    // Hallucinated: nobody said this.
    { decision: "Translate onboarding emails into German", evidence_line: 9, evidence_quote: "we will translate everything into German" },
  ],
  action_items: [
    { task: "Fix the CSV export bug", owner: "Daniel", deadline: "Thursday", evidence_line: 2, evidence_quote: "I can have a fix ready by Thursday" },
    { task: "Send onboarding drafts to the team for comments", owner: "Ayesha", deadline: "by Monday", evidence_line: 8, evidence_quote: "send the drafts to the team for comments" },
    // Owner and deadline not stated: must become null.
    { task: "Check legal wording on trial terms", owner: "Sarah Khan", deadline: "next Friday", evidence_line: 6, evidence_quote: "check the legal wording on the trial terms" },
    // Quote cites the wrong line number (12 instead of 11) — should be located.
    { task: "Update the status page after the hotfix", owner: "Daniel", deadline: null, evidence_line: 12, evidence_quote: "update the status page once the hotfix is live" },
    // Duplicate of the first task.
    { task: "Fix the CSV export bug", owner: "Daniel", deadline: "Thursday", evidence_line: 2, evidence_quote: "fix ready by Thursday" },
    // Hallucinated quote.
    { task: "Book the offsite venue", owner: "Ayesha", deadline: null, evidence_line: 4, evidence_quote: "I will book the venue" },
  ],
  open_questions: ["Who owns legal review?", "Should the emails be translated into German?"],
});

export class StubMeetingAI implements MeetingAI {
  notesToReturn: Notes = productSyncNotes();
  received: string[] = [];
  followUpInput?: VerifiedNotes;
  followUpCalls = 0;
  fail?: Error;
  async notes(numberedTranscript: string, _meta: MeetingMeta) {
    if (this.fail) throw this.fail;
    this.received.push(numberedTranscript);
    return structuredClone(this.notesToReturn);
  }
  async followUp(notes: VerifiedNotes): Promise<FollowUp> {
    this.followUpInput = notes;
    this.followUpCalls++;
    return { subject: "Follow-up: product sync", body: notes.actionItems.map((a) => `- ${a.task} (Owner: ${a.owner ?? "TBD"})`).join("\n") };
  }
}

export class StubSTT implements SpeechToText {
  async transcribe(audio: Buffer) {
    return { transcript: `Speaker 1: received ${audio.length} bytes`, durationSeconds: 1.5, speakers: 1 };
  }
}

export function makeService(opts: { ai?: StubMeetingAI | null; stt?: SpeechToText | null } = {}) {
  const store = new MeetingStore(":memory:");
  const ai = opts.ai === undefined ? new StubMeetingAI() : opts.ai;
  const service = new MeetingService({ store, ai, stt: opts.stt ?? null, sender: "Mawra", maxLines: 500 });
  return { store, ai, service };
}

export async function startApp(opts: { apiKey?: string; ai?: StubMeetingAI | null; stt?: SpeechToText | null; trustProxy?: boolean; rateLimitPerMinute?: number } = {}) {
  const { store, ai, service } = makeService(opts);
  const router = createRouter({ service, store, apiKey: opts.apiKey, trustProxy: opts.trustProxy, rateLimitPerMinute: opts.rateLimitPerMinute ?? 1000, maxBodyBytes: 1024 * 1024, status: { claude: ai !== null, stt: !!opts.stt, model: "test" } });
  const server = createServer(router.handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, store, ai, close: () => closeServer(server) };
}

export function closeServer(server: Server) {
  return new Promise<void>((r) => server.close(() => r()));
}
