/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export for loading via file:// inside Electron.
  output: 'export',
  images: { unoptimized: true },
  // Compile the shared workspace package from source.
  transpilePackages: ['@reader/shared'],
};

export default nextConfig;
