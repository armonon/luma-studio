import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep Next/Turbopack scoped to this project when the parent folder also
  // contains a lockfile (as it does in the desktop development workspace).
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
