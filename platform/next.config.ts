import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@lusora/contracts", "@lusora/engine"],
  output: "standalone",
};

export default nextConfig;
