import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Runtime audio paths must not pull previous desktop builds or local data
  // into Next.js file tracing and recursively expand the installer.
  outputFileTracingExcludes: {
    '/*': [
      './src-tauri/**/*',
      './.review/**/*',
      './.git/**/*',
      './screenshots/**/*',
      './tests/**/*',
      './**/*.db',
      './**/*.db-*',
      './.env*',
    ],
  },
  async headers() {
    return [
      {
        // Prevent caching of HTML pages
        source: '/:path((?!_next/static/).*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
      // Next.js owns immutable caching for /_next/static assets.
    ]
  },
};

export default nextConfig;
