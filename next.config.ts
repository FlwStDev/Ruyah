import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "postforge.localtest.me",
    "*.localtest.me",
    "*.trycloudflare.com",
  ],
};

export default nextConfig;
