import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false, // the Pixi application is created once; strict-mode double mount just churns the GL context
};

export default nextConfig;
