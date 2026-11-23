import { readFileSync } from "node:fs";
import { gamePlayPath, validateRuntimeRegistry, viewerCsp } from "./config/runtime-policy.mjs";

const registry = validateRuntimeRegistry(JSON.parse(readFileSync(new URL("./config/game-runtimes.json", import.meta.url), "utf8")));
const viewerHeaders = game => [
  {key:'Content-Security-Policy',value:viewerCsp(game)},
  {key:'X-Frame-Options',value:'DENY'},
  {key:'X-Content-Type-Options',value:'nosniff'},
  {key:'Referrer-Policy',value:'no-referrer'},
  {key:'Strict-Transport-Security',value:'max-age=31536000'},
  {key:'Cross-Origin-Opener-Policy',value:'same-origin'},
  {key:'Cross-Origin-Resource-Policy',value:'same-origin'},
  {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()'},
  {key:'Cache-Control',value:'private, no-store'}
];

export default {
  poweredByHeader: false,
  reactStrictMode: true,
  async redirects() {
    return [
      // UNO vanity host is quarantined by src/proxy.ts to discard query strings.
      { source: '/:path*', has: [{ type: 'host', value: 'www.xd-play.com' }], destination: 'https://xd-play.com/:path*', permanent: true }
    ];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        {key:'X-Content-Type-Options',value:'nosniff'},
        {key:'Referrer-Policy',value:'no-referrer'},
        {key:'X-Frame-Options',value:'DENY'},
        {key:'Content-Security-Policy',value:"frame-ancestors 'none'; base-uri 'self'; object-src 'none'"},
        {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=(), payment=()'},
        {key:'Strict-Transport-Security',value:'max-age=86400'}
      ]
    },{
      source: '/games/:gameId/play',
      headers: viewerHeaders({publicLaunch:'staging_only'})
    }, ...registry.runtimes.map(game => ({
      source: gamePlayPath(game),
      headers: viewerHeaders(game)
    }))];
  }
};
