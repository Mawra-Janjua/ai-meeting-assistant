import { createServer } from "node:http";
import { loadConfig } from "./config.ts";
import { ClaudeClient } from "./claude.ts";
import { ClaudeMeetingAI } from "./ai.ts";
import { DeepgramSTT } from "./stt.ts";
import { MeetingStore } from "./store.ts";
import { MeetingService } from "./service.ts";
import { createRouter } from "./app.ts";

const config = loadConfig();
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
  rateLimitPerMinute: config.RATE_LIMIT_PER_MINUTE,
  maxBodyBytes: Math.round(config.MAX_BODY_MB * 1024 * 1024),
  status: { claude: claudeOn, stt: stt !== null, model: config.CLAUDE_MODEL },
  log,
});

const server = createServer(router.handle);
server.listen(config.PORT, config.HOST, () => {
  log(`AI Meeting Assistant listening on http://localhost:${config.PORT}`);
  if (!config.API_KEY) log("WARNING: API_KEY is not set — the API is unauthenticated.");
  if (!claudeOn) log("Claude is NOT configured: summarisation returns 503 until ANTHROPIC_API_KEY is set.");
  if (!stt) log("Speech-to-text is not configured (optional): set DEEPGRAM_API_KEY to enable /api/transcribe.");
});

const shutdown = () => server.close(() => (store.close(), process.exit(0)));
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
