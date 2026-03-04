import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'

export const Route = createFileRoute('/ws/$roomId')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (request.headers.get('Upgrade') !== 'websocket') {
          return new Response('Expected Upgrade: websocket', { status: 426 })
        }

        const roomId = params.roomId || 'lobby'
        const id = env.ROOMS.idFromName(roomId)
        const stub = env.ROOMS.get(id)

        return stub.fetch(request)
      },
    },
  },
})
