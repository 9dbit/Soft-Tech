export default {
  poweredByHeader: false,
  reactStrictMode: true,
  async redirects() {
    return [{ source: '/:path*', has: [{ type: 'host', value: 'www.xd-play.com' }], destination: 'https://xd-play.com/:path*', permanent: true }];
  }
};
