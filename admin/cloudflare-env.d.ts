declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    INTELION_API_KEY?: string;
    INTELION_API_BASE_URL?: string;
    INTELION_MODEL?: string;
  }
}
