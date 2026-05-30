/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Compile the shared workspace package from source.
  transpilePackages: ['@reader/shared'],
};

export default nextConfig;
