import { z } from "zod";

export const MeetingInputSchema = z.object({
  title: z.string().trim().max(200).optional(),
  date: z.iso.date().optional(),
  attendees: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
  transcript: z
    .string()
    .max(400_000, "transcript is longer than 400,000 characters")
    .refine((s) => s.trim().length >= 20, "transcript is too short to summarise"),
});
export type MeetingInput = z.infer<typeof MeetingInputSchema>;

const evidence = {
  evidence_line: z.number().int().describe("The [L#] number of the transcript line that states this"),
  evidence_quote: z.string().describe("A short verbatim quote from that line"),
};

/** Structured output requested from Claude. */
export const NotesSchema = z.object({
  summary: z.string().describe("3-6 sentence neutral summary of what was discussed"),
  key_points: z.array(z.string()),
  decisions: z.array(z.object({ decision: z.string(), ...evidence })),
  action_items: z.array(
    z.object({
      task: z.string(),
      owner: z.string().nullable().describe("Person explicitly assigned or who explicitly volunteered; else null"),
      deadline: z.string().nullable().describe("Deadline exactly as said (e.g. 'Friday', 'March 3'); else null"),
      ...evidence,
    }),
  ),
  open_questions: z.array(z.string()),
});
export type Notes = z.infer<typeof NotesSchema>;

export const FollowUpSchema = z.object({ subject: z.string(), body: z.string() });
export type FollowUp = z.infer<typeof FollowUpSchema>;

export type VerifiedDecision = { decision: string; line: number; quote: string };
export type VerifiedAction = {
  task: string;
  owner: string | null;
  /** Deadline exactly as spoken ("by Friday"), or null. */
  deadline: string | null;
  /** YYYY-MM-DD resolved in code from `deadline` + meeting date (src/dates.ts); null if unknown. */
  dueDate: string | null;
  line: number;
  quote: string;
  notes: string[];
};
export type Rejected = { kind: "decision" | "action_item"; text: string; reason: string };

export type VerifiedNotes = {
  summary: string;
  keyPoints: string[];
  decisions: VerifiedDecision[];
  actionItems: VerifiedAction[];
  openQuestions: string[];
  rejected: Rejected[];
};
