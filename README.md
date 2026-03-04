# Canvas Demo

A TanStack Start app running on Cloudflare Workers with Durable Objects and WebSockets for a shared, real-time drawing canvas.

## Development

Install dependencies:

```sh
npm install
```

Start the dev server:

```sh
npm run dev
```

Open two tabs on the same room to verify live drawing and cursor presence:

```
http://localhost:3000/?room=lobby
```

## Rooms

Use the room picker in the UI or set a room in the URL query:

```
/?room=design
```

Each room maps to a Durable Object instance for real-time fanout. The last few hundred stroke events are stored in Durable Object storage and replayed when a new client joins.

## Deployment

```sh
npm run deploy
```

## Cloudflare Bindings

Durable Object binding is configured in `wrangler.jsonc` under `ROOMS`.
