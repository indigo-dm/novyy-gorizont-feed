export async function onRequest(context) {
  try {
    const response = await context.env.FEED_API.fetch(context.request);
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

