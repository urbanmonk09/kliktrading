import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  reactCompiler: true,

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" }
    ]
  },

  experimental: {
    optimizePackageImports: ["react", "lucide-react"],
    serverActions: {
      bodySizeLimit: "5mb",       // Adjust based on uploads
      allowedOrigins: ["*"],      // Change to your domain in production
    },
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
