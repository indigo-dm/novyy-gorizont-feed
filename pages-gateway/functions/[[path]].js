export async function onRequest(context) {
  try {
    const request = context.request;
    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    let forwardedRequest = request;

    // A multipart body forwarded as the original request stream can arrive at a
    // service binding without its opening boundary. Rebuild upload forms here
    // so the runtime generates a fresh Content-Type boundary matching the body.
    if (request.method === 'POST' && (path === '/' || path === '/upload' || path === '/materials/upload')) {
      const form = await request.formData();
      const headers = new Headers(request.headers);
      headers.delete('Content-Type');
      headers.delete('Content-Length');
      forwardedRequest = new Request(request.url, {
        method: request.method,
        headers,
        body: form,
        redirect: request.redirect
      });
    }

    const response = await context.env.FEED_API.fetch(forwardedRequest);
    const headers = new Headers(response.headers);
    headers.set('X-Feed-Gateway', 'cloudflare-pages');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch (error) {
    console.error('Feed Studio gateway error', error);
    return Response.json(
      { error: 'Feed Studio API временно недоступен.' },
      {
        status: 502,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
          'X-Feed-Gateway': 'cloudflare-pages'
        }
      }
    );
  }
}
