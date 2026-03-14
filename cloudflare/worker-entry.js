export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', runtime: 'cloudflare-workers' });
    }

    return Response.json(
      {
        status: 'deployed',
        message: 'Cloudflare Workers deployment bootstrap is ready.',
        path: url.pathname,
      },
      { status: 200 }
    );
  },
};
