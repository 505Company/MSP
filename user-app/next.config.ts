import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // vinext applies this limit to multipart API uploads as well as server actions.
  experimental: { serverActions: { bodySizeLimit: "100mb" } },
};

export default nextConfig;
