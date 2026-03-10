/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Next.js 14's client-side Router Cache defaults to 30 seconds for dynamic routes.
    // This means router.refresh() can serve stale RSC payloads after a task move,
    // causing useEffect board-sync to revert the optimistic update.
    // Setting dynamic: 0 forces router.refresh() to always fetch a fresh RSC payload
    // from the server for dynamic routes (revalidate = 0 / force-dynamic).
    staleTimes: {
      dynamic: 0,
    },
  },
};

module.exports = nextConfig;
