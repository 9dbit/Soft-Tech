const skyGateOrigin="https://skygate-web-production.up.railway.app";
const skygateViewerCsp=[
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-src "+skyGateOrigin
].join("; ");

export default {
  poweredByHeader: false,
  reactStrictMode: true,
  async redirects() {
    return [
      { source: '/', has: [{ type: 'host', value: 'uno.xd-play.com' }], destination: 'https://xd-play.com/games/uno-luck', permanent: false },
      { source: '/:path*', has: [{ type: 'host', value: 'www.xd-play.com' }], destination: 'https://xd-play.com/:path*', permanent: true }
    ];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        {key:'X-Content-Type-Options',value:'nosniff'},
        {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
        {key:'X-Frame-Options',value:'DENY'},
        {key:'Content-Security-Policy',value:"frame-ancestors 'none'; base-uri 'self'; object-src 'none'"},
        {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=(), payment=()'},
        {key:'Strict-Transport-Security',value:'max-age=86400'}
      ]
    },{
      source: '/games/skygate-5000/play',
      headers: [
        {key:'Content-Security-Policy',value:skygateViewerCsp},
        {key:'X-Frame-Options',value:'DENY'},
        {key:'X-Content-Type-Options',value:'nosniff'},
        {key:'Referrer-Policy',value:'no-referrer'},
        {key:'Strict-Transport-Security',value:'max-age=31536000'},
        {key:'Cross-Origin-Opener-Policy',value:'same-origin'},
        {key:'Cross-Origin-Resource-Policy',value:'same-origin'},
        {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=()'},
        {key:'Cache-Control',value:'private, no-store'}
      ]
    }];
  }
};
