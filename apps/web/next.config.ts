import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@agon/types', '@agon/utils'],
};

export default nextConfig;
