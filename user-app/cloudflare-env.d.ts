declare namespace Cloudflare {
  interface Env {
    MSP_WORKER_TOKEN?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
    INTELION_API_KEY?: string;
    INTELION_API_BASE_URL?: string;
    INTELION_MODEL?: string;
    ROUTERAI_API_KEY?: string;
    ROUTERAI_MODEL?: string;
    ROUTERAI_PROVIDER?: string;
  }
}
