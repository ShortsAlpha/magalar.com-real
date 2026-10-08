import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Lets parallel local builds use separate output dirs (e.g. NEXT_DIST_DIR=.next-landing). Defaults to .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
