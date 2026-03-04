import handler, { createServerEntry } from '@tanstack/react-start/server-entry'

export { RoomDurableObject } from './durable-objects/room'

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request)
  },
})
