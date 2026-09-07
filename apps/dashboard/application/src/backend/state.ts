import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ActiveRun, PromptProfile } from "../shared/types.js";

export class RuntimeState {
  private readonly db: DatabaseSync;

  constructor(private readonly directory: string) {
    fs.mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(path.join(directory, "dashboard.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS prompt_profiles (
        task_type TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        prompt_mode TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS actions (
        action_id TEXT PRIMARY KEY,
        action_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_runs (
        run_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS action_idempotency (
        idempotency_key TEXT PRIMARY KEY,
        action_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS leases (
        lease_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
    try {
      this.db.exec(
        "ALTER TABLE prompt_profiles ADD COLUMN adapter TEXT NOT NULL DEFAULT 'codex_app_server'",
      );
    } catch {
      // Existing databases already have the column; keep startup idempotent.
    }
  }

  getPromptProfiles(): PromptProfile[] {
    const rows = this.db
      .prepare(
        "SELECT task_type, label, model, reasoning_effort, prompt_mode, adapter FROM prompt_profiles ORDER BY task_type",
      )
      .all() as Array<Record<string, string>>;
    return rows.map((row) => ({
      taskType: row.task_type as PromptProfile["taskType"],
      label: row.label,
      model: row.model,
      reasoningEffort: row.reasoning_effort as PromptProfile["reasoningEffort"],
      promptMode: row.prompt_mode as PromptProfile["promptMode"],
      adapter: (row.adapter ?? "codex_app_server") as PromptProfile["adapter"],
    }));
  }

  seedProfiles(profiles: PromptProfile[]): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO prompt_profiles (task_type, label, model, reasoning_effort, prompt_mode, adapter, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    for (const profile of profiles)
      insert.run(
        profile.taskType,
        profile.label,
        profile.model,
        profile.reasoningEffort,
        profile.promptMode,
        profile.adapter ?? "codex_app_server",
        now,
      );
  }

  updateProfile(profile: PromptProfile): PromptProfile {
    this.db
      .prepare(
        `INSERT INTO prompt_profiles (task_type, label, model, reasoning_effort, prompt_mode, adapter, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(task_type) DO UPDATE SET label=excluded.label, model=excluded.model, reasoning_effort=excluded.reasoning_effort, prompt_mode=excluded.prompt_mode, adapter=excluded.adapter, updated_at=excluded.updated_at`,
      )
      .run(
        profile.taskType,
        profile.label,
        profile.model,
        profile.reasoningEffort,
        profile.promptMode,
        profile.adapter ?? "codex_app_server",
        new Date().toISOString(),
      );
    return profile;
  }

  recordAction(
    actionType: string,
    payload: unknown,
    idempotencyKey?: string,
  ): string {
    if (idempotencyKey) {
      const existing = this.db
        .prepare(
          "SELECT action_id FROM action_idempotency WHERE idempotency_key = ?",
        )
        .get(idempotencyKey) as { action_id: string } | undefined;
      if (existing) return existing.action_id;
    }
    const actionId = `ACT-${crypto.randomUUID()}`;
    this.db
      .prepare(
        "INSERT INTO actions (action_id, action_type, payload, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        actionId,
        actionType,
        JSON.stringify(payload),
        new Date().toISOString(),
      );
    if (idempotencyKey)
      this.db
        .prepare(
          "INSERT INTO action_idempotency (idempotency_key, action_id) VALUES (?, ?)",
        )
        .run(idempotencyKey, actionId);
    return actionId;
  }

  hasAction(actionId: string): boolean {
    return Boolean(
      this.db
        .prepare("SELECT 1 FROM actions WHERE action_id = ?")
        .get(actionId),
    );
  }

  listActions(limit = 100): Array<{
    actionId: string;
    actionType: string;
    payload: unknown;
    createdAt: string;
  }> {
    const rows = this.db
      .prepare(
        "SELECT action_id, action_type, payload, created_at FROM actions ORDER BY created_at DESC LIMIT ?",
      )
      .all(limit) as Array<{
      action_id: string;
      action_type: string;
      payload: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      actionId: row.action_id,
      actionType: row.action_type,
      payload: JSON.parse(row.payload) as unknown,
      createdAt: row.created_at,
    }));
  }

  close(): void {
    this.db.close();
  }

  startRun(run: ActiveRun): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO runtime_runs (run_id, payload, status, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        run.runId,
        JSON.stringify(run),
        run.status,
        new Date().toISOString(),
      );
  }

  updateRun(runId: string, patch: Partial<ActiveRun>): ActiveRun | null {
    const existing = this.db
      .prepare("SELECT payload FROM runtime_runs WHERE run_id = ?")
      .get(runId) as { payload: string } | undefined;
    if (!existing) return null;
    const next = { ...(JSON.parse(existing.payload) as ActiveRun), ...patch };
    this.db
      .prepare(
        "UPDATE runtime_runs SET payload = ?, status = ?, updated_at = ? WHERE run_id = ?",
      )
      .run(JSON.stringify(next), next.status, new Date().toISOString(), runId);
    return next;
  }

  getActiveRun(): ActiveRun | null {
    const row = this.db
      .prepare(
        "SELECT payload FROM runtime_runs WHERE status IN ('ready', 'in_progress', 'blocked') ORDER BY updated_at DESC LIMIT 1",
      )
      .get() as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as ActiveRun) : null;
  }

  getRun(runId: string): ActiveRun | null {
    const row = this.db
      .prepare("SELECT payload FROM runtime_runs WHERE run_id = ?")
      .get(runId) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as ActiveRun) : null;
  }

  acquireLease(leaseId: string, owner: string, ttlMs: number): boolean {
    const now = Date.now();
    const existing = this.db
      .prepare("SELECT owner, expires_at FROM leases WHERE lease_id = ?")
      .get(leaseId) as { owner: string; expires_at: string } | undefined;
    if (
      existing &&
      existing.owner !== owner &&
      new Date(existing.expires_at).getTime() > now
    )
      return false;
    const acquiredAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttlMs).toISOString();
    this.db
      .prepare(
        "INSERT INTO leases (lease_id, owner, acquired_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(lease_id) DO UPDATE SET owner=excluded.owner, acquired_at=excluded.acquired_at, expires_at=excluded.expires_at",
      )
      .run(leaseId, owner, acquiredAt, expiresAt);
    return true;
  }

  releaseLease(leaseId: string, owner: string): void {
    this.db
      .prepare("DELETE FROM leases WHERE lease_id = ? AND owner = ?")
      .run(leaseId, owner);
  }
}
