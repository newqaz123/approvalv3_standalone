/** @type {import('next').NextConfig} */
const nextConfig = {
  // Nodemailer is Node-only. Keep it out of the instrumentation webpack
  // bundle and let the Node runtime resolve it directly.
  serverExternalPackages: ['nodemailer'],
  experimental: {
    optimizePackageImports: ['lucide-react'],
    serverActions: { bodySizeLimit: '15mb' },
  },
  async rewrites() {
    return [{ source: '/requests', destination: '/requests' }]
  },
}

export default nextConfig
