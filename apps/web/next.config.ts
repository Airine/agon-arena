import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@agon/types', '@agon/utils'],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  webpack(config: any, { isServer }: { isServer: boolean }) {
    if (isServer) {
      // Konva's Node.js entry requires 'canvas' for SSR.
      // We use konva client-side only (dynamic import, ssr:false), so stub it out.
      config.resolve = config.resolve ?? {};
      config.resolve.alias = { ...(config.resolve.alias ?? {}), canvas: false };
    }
    return config;
  },
};

export default nextConfig;
