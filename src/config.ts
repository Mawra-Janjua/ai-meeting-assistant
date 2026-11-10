import { z } from "zod";

const optional = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().optional());

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4104),
  HOST: z.string().default("0.0.0.0"),
  API_KEY: optional,
  ANTHROPIC_API_KEY: optional,
  CLAUDE_MODEL: z.string().default("claude-opus-5-5"),
  CLAUDE_FALLBACKS: z.enum(["default", "off"]).default("default"),
  DATABASE_PATH: z.string().default("./data/meetings.db"),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  MAX_BODY_MB: z.coerce.number().positive().max(200).default(50),
  MAX_TRANSCRIPT_LINES: z.coerce.number().int().positive().default(5000),
  FOLLOWUP_SENDER: z.string().default("the meeting organiser"),
  DEEPGRAM_API_KEY: optional,
  DEEPGRAM_MODEL: z.string().default("nova-3"),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  return parsed.data;
}
