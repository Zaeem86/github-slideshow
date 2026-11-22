import type { NextConfig } from "next";

// Security headers for every response.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
  // The site may not be embedded in other sites' frames (clickjacking protection).
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'" },
  { key: "X-Frame-Options", value: "DENY" }
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Inspection photos are sent to a Server Action one by one (JPEG, max 1280 px).
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  }
};

export default nextConfig;
