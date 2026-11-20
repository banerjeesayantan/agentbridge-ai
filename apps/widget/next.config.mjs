/** @type {import('next').NextConfig} */
const nextConfig = {
  // Vercel mounts this service at /widget and forwards the original path.
  basePath: "/widget",
  transpilePackages: ["@workspace/ui"],
}

export default nextConfig
