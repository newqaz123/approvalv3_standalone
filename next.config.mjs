/** @type {import('next').NextConfig} */
const nextConfig = {
  // Nodemailer and Sharp are Node-only. Keep them out of the
  // instrumentation webpack bundle and let the Node runtime resolve
  // them directly (Sharp ships native bindings).
  serverExternalPackages: ['nodemailer', 'sharp'],
  experimental: {
    optimizePackageImports: ['lucide-react'],
    serverActions: { bodySizeLimit: '15mb' },
  },
  async rewrites() {
    return [{ source: '/requests', destination: '/requests' }]
  },
}

export default nextConfig
