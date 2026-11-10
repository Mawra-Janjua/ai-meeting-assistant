import { createServer } from "node:http";
import { loadConfig } from "./config.ts";
import { ClaudeClient } from "./claude.ts";
import { ClaudeMeetingAI } from "./ai.ts";
import { DeepgramSTT } from "./stt.ts";
import { MeetingStore } from "./store.ts";
import { MeetingService } from "./service.ts";
import { createRouter } from "./app.ts";
import { assertAuthConfigured } from "./http.ts";

const config = loadConfig();
try {
  assertAuthConfigured(config.HOST, config.API_KEY);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
const log = (msg: string, extra?: unknown) =>
  console.log(`[${new Date().toISOString()}] ${msg}`, extra instanceof Error ? extra.stack : (extra ?? ""));

const store = new MeetingStore(config.DATABASE_PATH);
const claudeOn = Boolean(config.ANTHROPIC_API_KEY);
const ai = claudeOn
  ? new ClaudeMeetingAI(new ClaudeClient({ apiKey: config.ANTHROPIC_API_KEY, model: config.CLAUDE_MODEL, fallbacks: config.CLAUDE_FALLBACKS, timeoutMs: 300_000 }))
  : null;
const stt = config.DEEPGRAM_API_KEY ? new DeepgramSTT(config.DEEPGRAM_API_KEY, { model: config.DEEPGRAM_MODEL }) : null;

const service = new MeetingService({ store, ai, stt, sender: config.FOLLOWUP_SENDER, maxLines: config.MAX_TRANSCRIPT_LINES });
const router = createRouter({
  service,
  store,
  apiKey: config.API_KEY,
  trustProxy: config.TRUST_PROXY,
  rateLimitPerMinute: config.RATE_LIMIT_PER_MINUTE,
  maxBodyBytes: Math.round(config.MAX_BODY_MB * 1024 * 1024),
  status: { claude: claudeOn, stt: stt !== null, model: config.CLAUDE_MODEL },
  log,
});

const server = createServer(router.handle);
// Timeouts. Worst case per request: Claude notes call (300 s timeout, SDK retries up to 3x)
// + follow-up call (same) + Deepgram for /api/meetings/audio (600 s) — well over Node's
// 300 s default for requestTimeout. Node's requestTimeout/headersTimeout only bound how long the
// client may take to *send* the request; handler time is bounded by socket inactivity
// (server.timeout), which we keep disabled so a long Claude call is never cut off mid-response.
server.requestTimeout = 30 * 60_000; // 30 min: slow uploads of up to MAX_BODY_MB of audio
server.headersTimeout = 60_000; // 60 s to send headers (must be <= requestTimeout)
server.timeout = 0; // no socket inactivity timeout while Claude/Deepgram are working
server.listen(config.PORT, config.HOST, () => {
  log(`AI Meeting Assistant listening on http://${config.HOST}:${config.PORT}`);
  if (!config.API_KEY) log("API_KEY is not set: unauthenticated, loopback only (local development).");
  if (!claudeOn) log("Claude is NOT configured: summarisation returns 503 until ANTHROPIC_API_KEY is set.");
  if (!stt) log("Speech-to-text is not configured (optional): set DEEPGRAM_API_KEY to enable /api/transcribe and /api/meetings/audio.");
});

const shutdown = () => server.close(() => (store.close(), process.exit(0)));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
