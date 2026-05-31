/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Server-rendered standalone output for web/Docker deployment.
  output: 'standalone',
  images: { unoptimized: true },
  // Compile the shared workspace package from source.
  transpilePackages: ['@reader/shared'],
};

export default nextConfig;
