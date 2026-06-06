import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Google Places photo media host (we also render these with `unoptimized`)
    remotePatterns: [{ protocol: "https", hostname: "places.googleapis.com" }],
  },
};

export default nextConfig;
