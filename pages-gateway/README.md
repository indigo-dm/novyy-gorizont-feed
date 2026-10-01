# Feed Studio API gateway

Cloudflare Pages gateway for the Feed Studio API. It exposes the existing
`indigo-feed-studio-upload` Worker through a custom subdomain whose DNS remains
outside Cloudflare.

The Pages Function forwards requests through the `FEED_API` service binding,
so browser traffic does not depend on the public `workers.dev` hostname.

