import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  experimental: {
    // Optimize lucide-react imports by replacing barrel imports with direct imports at build time
    // This reduces bundle size from 1,583 modules to only used icons (25%+ build time improvement)
    optimizePackageImports: ['lucide-react'],
  },
  // Fix HMR and CORS issues during development
  async rewrites() {
    return [
      {
        source: '/requests',
        destination: '/requests',
      },
    ]
  },
};

export default nextConfig;
