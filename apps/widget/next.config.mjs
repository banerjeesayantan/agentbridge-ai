/** @type {import('next').NextConfig} */
const nextConfig = {
  // Public ingress maps /widget/* to this service; basePath keeps Next.js
  // routes and static assets under the same prefix.
  basePath: "/widget",
  transpilePackages: ["@workspace/ui"],
};

export default nextConfig;
