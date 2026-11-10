import { HttpError, Router, type Ctx } from "./http.ts";
import { MeetingInputSchema, type MeetingInput } from "./schemas.ts";
import { AUDIO_TYPES } from "./stt.ts";
import { toMarkdown } from "./export.ts";
import type { MeetingService } from "./service.ts";
import type { MeetingRecord, MeetingStore } from "./store.ts";

export type AppOptions = {
  service: MeetingService;
  store: MeetingStore;
  apiKey?: string;
  rateLimitPerMinute: number;
  maxBodyBytes: number;
  status: { claude: boolean; stt: boolean; model: string };
  log?: (msg: string, extra?: unknown) => void;
};

const TEXT_TYPES = ["text/plain", "text/vtt", "application/x-subrip", "text/srt"];

/** JSON body, or a raw transcript file (txt / vtt / srt) with metadata in the query string. */
async function readMeetingInput(ctx: Ctx): Promise<MeetingInput> {
  const type = (ctx.req.headers["content-type"] ?? "").split(";")[0].trim();
  if (TEXT_TYPES.includes(type)) {
    const attendees = ctx.query.get("attendees");
    return MeetingInputSchema.parse({
      transcript: (await ctx.rawBody()).toString("utf8"),
      title: ctx.query.get("title") ?? undefined,
      date: ctx.query.get("date") ?? undefined,
      attendees: attendees ? attendees.split(",").map((a) => a.trim()).filter(Boolean) : undefined,
    });
  }
  return MeetingInputSchema.parse(await ctx.body());
}

const followUpFlag = (ctx: Ctx) => ctx.query.get("followUp") !== "false";

export function present(m: MeetingRecord) {
  const { transcript, ...rest } = m;
  return { ...rest, transcriptChars: transcript.length };
}

export function createRouter(o: AppOptions) {
  const r = new Router({ apiKey: o.apiKey, rateLimitPerMinute: o.rateLimitPerMinute, maxBodyBytes: o.maxBodyBytes, log: o.log });

  r.on(
    "GET",
    "/health",
    () => ({ json: { ok: true, service: "ai-meeting-assistant", integrations: { claude: o.status.claude, speechToText: o.status.stt }, model: o.status.claude ? o.status.model : null } }),
    { public: true },
  );

  r.on("POST", "/api/meetings", async (ctx) => {
    const m = await o.service.create(await readMeetingInput(ctx), { followUp: followUpFlag(ctx) });
    return { status: 201, json: { meeting: present(m) } };
  });

  r.on("POST", "/api/analyze", async (ctx) => {
    const input = await readMeetingInput(ctx);
    const { transcript, notes, followUp } = await o.service.summarize(input, { followUp: followUpFlag(ctx) });
    return {
      json: {
        speakers: transcript.speakers,
        lineCount: transcript.lines.length,
        format: transcript.format,
        notes,
        followUp,
        markdown: toMarkdown({ title: input.title ?? null, date: input.date ?? null, attendees: input.attendees ?? [], speakers: transcript.speakers }, notes, followUp),
      },
    };
  });

  r.on("POST", "/api/transcribe", async (ctx) => {
    const type = (ctx.req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (!AUDIO_TYPES.includes(type)) throw new HttpError(415, "unsupported_media_type", `Send the audio with one of these Content-Types: ${AUDIO_TYPES.join(", ")}`);
    return { json: await o.service.transcribe(await ctx.rawBody(), type) };
  });

  r.on("GET", "/api/meetings", (ctx) => {
    const limit = Math.min(200, Math.max(1, Number(ctx.query.get("limit") ?? 50) || 50));
    return { json: { meetings: o.store.list(limit) } };
  });

  r.on("GET", "/api/meetings/:id", (ctx) => ({ json: { meeting: present(o.service.mustGet(ctx.params.id)) } }));

  r.on("GET", "/api/meetings/:id/export.md", (ctx) => {
    const m = o.service.mustGet(ctx.params.id);
    return {
      text: toMarkdown(m, m.notes, m.followUp),
      contentType: "text/markdown; charset=utf-8",
      headers: { "content-disposition": `attachment; filename="meeting-${m.date ?? m.createdAt.slice(0, 10)}.md"` },
    };
  });

  r.on("GET", "/api/meetings/:id/export.json", (ctx) => {
    const m = o.service.mustGet(ctx.params.id);
    return {
      text: JSON.stringify(present(m), null, 2),
      contentType: "application/json; charset=utf-8",
      headers: { "content-disposition": `attachment; filename="meeting-${m.id}.json"` },
    };
  });

  return r;
}
