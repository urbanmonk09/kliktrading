import type { NextConfig } from 'next';
import type { Configuration } from 'webpack'; // Import Webpack's Configuration type

const nextConfig: NextConfig = {
  reactStrictMode: true,

  turbopack: {}, // Disable Turbopack by passing an empty object

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },

  experimental: {
    optimizePackageImports: ["react", "lucide-react"],
    serverActions: {
      bodySizeLimit: "5mb",       // Adjust based on uploads
      allowedOrigins: ["*"],      // Change to your domain in production
    },
  },

  webpack(config: Configuration, { isServer }: { isServer: boolean }) {
    if (!isServer) {
      // Ensure that `config.resolve` is defined before modifying it
      config.resolve = config.resolve || {}; // Initialize it if undefined
      config.resolve.fallback = {
        tls: false,
        net: false,
        http: false,
        https: false,
      };
    }
    return config;
  },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
