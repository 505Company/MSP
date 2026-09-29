import { env } from "cloudflare:workers"

import type {
  CreateUploadJob,
  QwenStatus,
  UploadJob,
  UploadJobPatch,
  UploadJobStatus,
  UploadRepository,
} from "@/lib/uploads/domain"

type UploadRow = {
  id: string
  batch_id: string
  file_name: string
  size_bytes: number
  status: string
  stage: string
  progress: number
  slide_count: number | null
  object_count: number | null
  color_count: number | null
  typography_count: number | null
  warning_count: number | null
  qwen_status: string
  source_object_key: string | null
  profile_object_key: string | null
  analysis_object_key: string | null
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

const patchColumns: Record<keyof UploadJobPatch, string> = {
  status: "status",
  stage: "stage",
  progress: "progress",
  slideCount: "slide_count",
  objectCount: "object_count",
  colorCount: "color_count",
  typographyCount: "typography_count",
  warningCount: "warning_count",
  qwenStatus: "qwen_status",
  sourceObjectKey: "source_object_key",
  profileObjectKey: "profile_object_key",
  analysisObjectKey: "analysis_object_key",
  errorCode: "error_code",
  errorMessage: "error_message",
}

let schemaReady = false

function database(): D1Database {
  if (!env.DB) throw new Error("D1 binding DB is unavailable")
  return env.DB
}

export function objectBucket(): R2Bucket {
  if (!env.BUCKET) throw new Error("R2 binding BUCKET is unavailable")
  return env.BUCKET
}

export async function ensureUploadSchema(): Promise<void> {
  if (schemaReady) return
  const db = database()
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS upload_jobs (
      id TEXT PRIMARY KEY NOT NULL,
      batch_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      progress INTEGER NOT NULL,
      slide_count INTEGER,
      object_count INTEGER,
      color_count INTEGER,
      typography_count INTEGER,
      warning_count INTEGER,
      qwen_status TEXT NOT NULL,
      source_object_key TEXT,
      profile_object_key TEXT,
      analysis_object_key TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_upload_jobs_updated_at ON upload_jobs(updated_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_upload_jobs_status_updated_at ON upload_jobs(status, updated_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_upload_jobs_batch_id ON upload_jobs(batch_id)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      details_json TEXT,
      created_at TEXT NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_audit_events_entity ON audit_events(entity_type, entity_id, created_at)"),
  ])
  await db.prepare("PRAGMA optimize").run()
  schemaReady = true
}

function fromRow(row: UploadRow): UploadJob {
  return {
    id: row.id,
    batchId: row.batch_id,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    status: row.status as UploadJobStatus,
    stage: row.stage,
    progress: row.progress,
    slideCount: row.slide_count,
    objectCount: row.object_count,
    colorCount: row.color_count,
    typographyCount: row.typography_count,
    warningCount: row.warning_count,
    qwenStatus: row.qwen_status as QwenStatus,
    sourceObjectKey: row.source_object_key,
    profileObjectKey: row.profile_object_key,
    analysisObjectKey: row.analysis_object_key,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function createCloudflareUploadRepository(): UploadRepository {
  const db = database()

  return {
    async create(input: CreateUploadJob) {
      const now = new Date().toISOString()
      await db
        .prepare(`INSERT INTO upload_jobs (
          id, batch_id, file_name, size_bytes, status, stage, progress,
          qwen_status, source_object_key, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          input.id,
          input.batchId,
          input.fileName,
          input.sizeBytes,
          "queued",
          "Проверка файла",
          5,
          "pending",
          input.sourceObjectKey,
          now,
          now
        )
        .run()
      return (await this.get(input.id))!
    },

    async get(id: string) {
      const row = await db.prepare("SELECT * FROM upload_jobs WHERE id = ?").bind(id).first<UploadRow>()
      return row ? fromRow(row) : null
    },

    async list(limit = 100) {
      const safeLimit = Math.min(Math.max(limit, 1), 200)
      const result = await db
        .prepare("SELECT * FROM upload_jobs ORDER BY updated_at DESC LIMIT ?")
        .bind(safeLimit)
        .all<UploadRow>()
      return result.results.map(fromRow)
    },

    async update(id: string, patch: UploadJobPatch) {
      const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as Array<
        [keyof UploadJobPatch, UploadJobPatch[keyof UploadJobPatch]]
      >
      if (!entries.length) {
        const existing = await this.get(id)
        if (!existing) throw new Error(`Upload job ${id} was not found`)
        return existing
      }

      const columns = entries.map(([key]) => `${patchColumns[key]} = ?`)
      const values = entries.map(([, value]) => value ?? null)
      columns.push("updated_at = ?")
      values.push(new Date().toISOString())
      await db
        .prepare(`UPDATE upload_jobs SET ${columns.join(", ")} WHERE id = ?`)
        .bind(...values, id)
        .run()
      const updated = await this.get(id)
      if (!updated) throw new Error(`Upload job ${id} was not found after update`)
      return updated
    },

    async audit(input) {
      await db
        .prepare(`INSERT INTO audit_events (
          id, actor_id, action, entity_type, entity_id, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(
          crypto.randomUUID(),
          input.actorId,
          input.action,
          input.entityType,
          input.entityId,
          input.details ? JSON.stringify(input.details) : null,
          new Date().toISOString()
        )
        .run()
    },
  }
}

