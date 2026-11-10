import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { FollowUp, VerifiedNotes } from "./schemas.ts";

export type MeetingRecord = {
  id: string;
  title: string | null;
  date: string | null;
  attendees: string[];
  speakers: string[];
  format: string;
  lineCount: number;
  transcript: string;
  notes: VerifiedNotes;
  followUp: FollowUp | null;
  createdAt: string;
};

type Row = { id: string; data: string; created_at: string; idempotency_key?: string | null };

export class MeetingStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meetings (id TEXT PRIMARY KEY, title TEXT, data TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
    // Migration for databases created before idempotency keys existed.
    const cols = this.db.prepare("PRAGMA table_info(meetings)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "idempotency_key")) this.db.exec("ALTER TABLE meetings ADD COLUMN idempotency_key TEXT");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS meetings_idempotency_key ON meetings (idempotency_key) WHERE idempotency_key IS NOT NULL");
  }

  insert(m: Omit<MeetingRecord, "id" | "createdAt">, idempotencyKey?: string): MeetingRecord {
    const rec: MeetingRecord = { ...m, id: randomUUID(), createdAt: new Date().toISOString() };
    const { id, createdAt, ...data } = rec;
    this.db
      .prepare("INSERT INTO meetings (id, title, data, created_at, idempotency_key) VALUES (?, ?, ?, ?, ?)")
      .run(id, rec.title, JSON.stringify(data), createdAt, idempotencyKey ?? null);
    return rec;
  }

  get(id: string): MeetingRecord | undefined {
    const row = this.db.prepare("SELECT * FROM meetings WHERE id = ?").get(id) as Row | undefined;
    return row ? fromRow(row) : undefined;
  }

  getByIdempotencyKey(key: string): MeetingRecord | undefined {
    const row = this.db.prepare("SELECT * FROM meetings WHERE idempotency_key = ?").get(key) as Row | undefined;
    return row ? fromRow(row) : undefined;
  }

  list(limit: number) {
    return (this.db.prepare("SELECT * FROM meetings ORDER BY created_at DESC LIMIT ?").all(limit) as Row[]).map((r) => {
      const d = JSON.parse(r.data) as MeetingRecord;
      return { id: r.id, title: d.title, date: d.date, decisions: d.notes.decisions.length, actionItems: d.notes.actionItems.length, createdAt: r.created_at };
    });
  }

  close() {
    this.db.close();
  }
}

const fromRow = (row: Row): MeetingRecord => ({ id: row.id, createdAt: row.created_at, ...(JSON.parse(row.data) as Omit<MeetingRecord, "id" | "createdAt">) });
