// Real Anthropic SDK against a mock Messages API, and the Deepgram client against a fake fetch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ClaudeClient } from "../src/claude.ts";
import { ClaudeMeetingAI } from "../src/ai.ts";
import { DeepgramSTT, formatUtterances } from "../src/stt.ts";
import { numbered, parseTranscript } from "../src/transcript.ts";
import { closeServer, productSyncNotes, transcriptFixture } from "./helpers.ts";

async function mockApi(replies: unknown[]) {
  const bodies: any[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    bodies.push(JSON.parse(Buffer.concat(chunks).toString()));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({
      id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(replies.shift()) }], stop_reason: "end_turn", stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bodies, close: () => closeServer(server) };
}

test("notes request: numbered transcript inside <transcript>, schema requires evidence", async () => {
  const api = await mockApi([productSyncNotes()]);
  try {
    const ai = new ClaudeMeetingAI(new ClaudeClient({ apiKey: "k", model: "claude-opus-5-5", fallbacks: "default", baseURL: api.baseURL }));
    const notes = await ai.notes(numbered(parseTranscript(transcriptFixture("product-sync.txt"))), { title: "Product sync", attendees: ["Sarah Khan"] });
    assert.equal(notes.decisions.length, 2);
    const body = api.bodies[0];
    assert.match(body.messages[0].content, /Title: Product sync\nAttendees: Sarah Khan\n<transcript>\n\[L1\] Sarah Khan:/);
    assert.match(body.system, /Never infer owners/);
    const action = body.output_config.format.schema.properties.action_items.items;
    assert.ok(action.required.includes("evidence_quote") && action.required.includes("owner"));
  } finally {
    await api.close();
  }
});

test("follow-up request contains only verified items with TBD owners", async () => {
  const api = await mockApi([{ subject: "Follow-up", body: "Thanks all" }]);
  try {
    const ai = new ClaudeMeetingAI(new ClaudeClient({ apiKey: "k", model: "claude-opus-5-5", fallbacks: "off", baseURL: api.baseURL }));
    await ai.followUp(
      { summary: "S", keyPoints: [], decisions: [], actionItems: [{ task: "Legal review", owner: null, deadline: "by Friday", dueDate: "2026-11-13", line: 6, quote: "q", notes: [] }], openQuestions: [], rejected: [{ kind: "action_item", text: "Book venue", reason: "x" }] },
      {},
      "Mawra",
    );
    const content = api.bodies[0].messages[0].content as string;
    assert.match(content, /"owner": "TBD"/);
    assert.match(content, /"deadline": "by Friday",\s+"due_date": "2026-11-13"/, "spoken deadline and code-resolved date");
    assert.match(api.bodies[0].system, /Never compute or change dates yourself/);
    assert.doesNotMatch(content, /Book venue/, "rejected items are never sent to the email writer");
    assert.equal(api.bodies[0].output_config.effort, "low");
  } finally {
    await api.close();
  }
});

test("Deepgram client: request shape, diarized formatting, error mapping", async () => {
  let captured: { url: string; init: RequestInit } | undefined;
  const ok = (async (url: string | URL, init?: RequestInit) => {
    captured = { url: String(url), init: init! };
    return Response.json({ metadata: { duration: 12.3 }, results: { utterances: [{ speaker: 0, transcript: "Hello team." }, { speaker: 1, transcript: "Hi!" }, { speaker: 0, transcript: " " }] } });
  }) as typeof fetch;
  const out = await new DeepgramSTT("dg-key", { fetchImpl: ok }).transcribe(Buffer.from("audio"), "audio/wav");
  assert.deepEqual(out, { transcript: "Speaker 1: Hello team.\nSpeaker 2: Hi!", durationSeconds: 12.3, speakers: 2 });
  const u = new URL(captured!.url);
  assert.equal(u.searchParams.get("diarize"), "true");
  assert.equal(u.searchParams.get("model"), "nova-3");
  assert.equal((captured!.init.headers as Record<string, string>).authorization, "Token dg-key");

  const denied = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(new DeepgramSTT("bad", { fetchImpl: denied }).transcribe(Buffer.from("a"), "audio/wav"), (e: Error & { code?: string }) => e.code === "stt_auth_failed");
  assert.throws(() => formatUtterances([], 3), (e: Error & { code?: string }) => e.code === "no_speech");
});
