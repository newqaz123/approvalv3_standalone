/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    optimizePackageImports: ['lucide-react'],
    serverActions: { bodySizeLimit: '15mb' },
  },
  async rewrites() {
    return [{ source: '/requests', destination: '/requests' }]
  },
}

export default nextConfig
