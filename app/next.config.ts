import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Modelo ONNX do @imgly roda só no browser (client import dinâmico).
  serverExternalPackages: ["@imgly/background-removal"],
};

export default nextConfig;
