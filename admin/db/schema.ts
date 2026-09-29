import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const uploadJobs = sqliteTable(
  "upload_jobs",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    fileName: text("file_name").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: text("status").notNull(),
    stage: text("stage").notNull(),
    progress: integer("progress").notNull(),
    slideCount: integer("slide_count"),
    objectCount: integer("object_count"),
    colorCount: integer("color_count"),
    typographyCount: integer("typography_count"),
    warningCount: integer("warning_count"),
    qwenStatus: text("qwen_status").notNull(),
    sourceObjectKey: text("source_object_key"),
    profileObjectKey: text("profile_object_key"),
    analysisObjectKey: text("analysis_object_key"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_upload_jobs_updated_at").on(table.updatedAt),
    index("idx_upload_jobs_status_updated_at").on(table.status, table.updatedAt),
    index("idx_upload_jobs_batch_id").on(table.batchId),
  ]
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    detailsJson: text("details_json"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_audit_events_entity").on(table.entityType, table.entityId, table.createdAt),
  ]
);
