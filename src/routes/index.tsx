import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type StrokePayload = {
  type: 'stroke'
  id: string
  color: string
  size: number
  points: Array<[number, number]>
  deltas?: Array<[number, number]>
}

type ClearPayload = {
  type: 'clear'
  id: string
}

type HelloPayload = {
  type: 'hello'
  id: string
  color: string
}

type RoomMessage = StrokePayload | ClearPayload | HelloPayload

const ROOM_QUERY_KEY = 'room'

export const Route = createFileRoute('/')({
  component: Home,
  validateSearch: (search) => {
    if (typeof search.room === 'string' && search.room.length > 0) {
      return { room: search.room }
    }
    return { room: 'lobby' }
  },
})

function Home() {
  const { room } = Route.useSearch()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<[number, number] | null>(null)
  const strokesRef = useRef<Array<StrokePayload | ClearPayload>>([])
  const strokeBufferRef = useRef<{
    color: string
    size: number
    points: Array<[number, number]>
  } | null>(null)
  const flushTimeoutRef = useRef<number | null>(null)
  const flushDelayMs = 50
  const [status, setStatus] = useState('Connecting')
  const [clientId, setClientId] = useState<string | null>(null)
  const [clientColor, setClientColor] = useState<string>('#ffffff')
  const [brushSize, setBrushSize] = useState(4)
  const navigate = useNavigate({ from: '/' })

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
  }, [])

  const expandStrokePoints = useCallback((message: StrokePayload) => {
    if (!message.deltas || message.deltas.length === 0) {
      return message.points
    }
    const points = [...message.points]
    let last = points[0]
    message.deltas.forEach(([dx, dy]) => {
      const next: [number, number] = [last[0] + dx, last[1] + dy]
      points.push(next)
      last = next
    })
    return points
  }, [])

  const drawStrokeToCanvas = useCallback((message: StrokePayload) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.strokeStyle = message.color
    ctx.lineWidth = message.size

    const points = expandStrokePoints(message)
    if (points.length === 0) return
    ctx.beginPath()
    ctx.moveTo(points[0][0], points[0][1])
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i][0], points[i][1])
    }
    ctx.stroke()
  }, [expandStrokePoints])

  const redrawFromHistory = useCallback(() => {
    clearCanvas()
    strokesRef.current.forEach((message) => {
      if (message.type === 'clear') {
        clearCanvas()
      } else {
        drawStrokeToCanvas(message)
      }
    })
  }, [clearCanvas, drawStrokeToCanvas])

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const resize = () => {
      const rect = container.getBoundingClientRect()
      const pixelRatio = window.devicePixelRatio || 1
      canvas.width = Math.floor(rect.width * pixelRatio)
      canvas.height = Math.floor(rect.height * pixelRatio)
      canvas.style.width = `${rect.width}px`
      canvas.style.height = `${rect.height}px`
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
      }
      redrawFromHistory()
    }

    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [redrawFromHistory])

  const drawRemoteStroke = useCallback(
    (message: StrokePayload) => {
      const expandedPoints = expandStrokePoints(message)
      const normalized: StrokePayload = {
        ...message,
        points: expandedPoints,
        deltas: undefined,
      }
      strokesRef.current.push(normalized)
      drawStrokeToCanvas(normalized)
    },
    [drawStrokeToCanvas, expandStrokePoints],
  )

  const sendMessage = useCallback((message: RoomMessage) => {
    const socket = wsRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    socket.send(JSON.stringify(message))
  }, [])

  const flushStrokeBuffer = useCallback(() => {
    if (!strokeBufferRef.current) return
      const { color, size, points } = strokeBufferRef.current
      if (points.length === 0) return

    const first = points[0]
    const deltas: Array<[number, number]> = []
    for (let i = 1; i < points.length; i += 1) {
      deltas.push([points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]])
    }

      sendMessage({
        type: 'stroke',
        id: clientId ?? '',
        color,
        size,
        points: [first],
        deltas,
      })

    strokeBufferRef.current = null
  }, [clientId, sendMessage])

  const scheduleStrokeFlush = useCallback(() => {
    if (flushTimeoutRef.current !== null) return
    flushTimeoutRef.current = window.setTimeout(() => {
      flushTimeoutRef.current = null
      flushStrokeBuffer()
    }, flushDelayMs)
  }, [flushStrokeBuffer])

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    if (event.button !== 0) return
    drawingRef.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = getCanvasPoint(event)
    lastPointRef.current = point
    strokeBufferRef.current = {
      color: clientColor,
      size: brushSize,
      points: [point],
    }
    scheduleStrokeFlush()
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    const point = getCanvasPoint(event)
    if (drawingRef.current) {
      const last = lastPointRef.current
      const points = last ? [last, point] : [point]
      lastPointRef.current = point
      if (!strokeBufferRef.current) {
        strokeBufferRef.current = {
          color: clientColor,
          size: brushSize,
          points,
        }
      } else {
        strokeBufferRef.current.points.push(point)
      }
      scheduleStrokeFlush()
    }

  }

  const handlePointerUp = (event?: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false
    lastPointRef.current = null
    flushStrokeBuffer()
    if (event) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        // ignore
      }
    }
  }


  useEffect(() => {
    strokesRef.current = []
    clearCanvas()

    const wsUrl = new URL(`/ws/${room}`, window.location.href)
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:'

    const socket = new WebSocket(wsUrl)
    wsRef.current = socket
    setStatus('Connecting')

    socket.addEventListener('open', () => setStatus('Live'))
    socket.addEventListener('close', () => {
      setStatus('Disconnected')
    })
    socket.addEventListener('error', () => setStatus('Error'))

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data) as RoomMessage
      if (message.type === 'hello') {
        setClientId(message.id)
        setClientColor(message.color)
        return
      }

      if (message.type === 'stroke') {
        drawRemoteStroke(message)
        return
      }

      if (message.type === 'clear') {
        strokesRef.current = [message]
        clearCanvas()
      }
    })

    return () => {
      if (flushTimeoutRef.current !== null) {
        clearTimeout(flushTimeoutRef.current)
        flushTimeoutRef.current = null
      }
      strokeBufferRef.current = null
      socket.close()
      wsRef.current = null
    }
  }, [clearCanvas, drawRemoteStroke, room])


  const handleClear = () => {
    clearCanvas()
    sendMessage({ type: 'clear', id: clientId ?? '' })
  }

  const handleRoomSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const nextRoom = String(formData.get(ROOM_QUERY_KEY) || '').trim()
    const targetRoom = nextRoom.length > 0 ? nextRoom : 'lobby'
    navigate({ search: { room: targetRoom } })
  }

  const roomLabel = useMemo(() => room.toLowerCase(), [room])

  return (
    <div className="canvas-app">
      <header className="canvas-header">
        <div>
          <p className="eyebrow">Room</p>
          <h1 className="room-title">{roomLabel}</h1>
        </div>
        <div className="status-chip" data-status={status.toLowerCase()}>
          {status}
        </div>
      </header>

      <section className="canvas-panel">
        <div className="toolbar">
          <div className="toolbar-group">
            <span className="label">Brush</span>
            <input
              type="range"
              min={2}
              max={16}
              step={1}
              value={brushSize}
              onChange={(event) => setBrushSize(Number(event.target.value))}
            />
            <span className="value">{brushSize}px</span>
          </div>
          <button type="button" className="ghost-button" onClick={handleClear}>
            Clear
          </button>
          <form className="room-form" onSubmit={handleRoomSubmit}>
            <label htmlFor="room-input">Room</label>
            <input
              id="room-input"
              name={ROOM_QUERY_KEY}
              placeholder="lobby"
              defaultValue={room}
            />
            <button type="submit" className="primary-button">
              Join
            </button>
          </form>
        </div>

        <div className="canvas-stage" ref={containerRef}>
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={() => handlePointerUp()}
            style={{ touchAction: 'none' }}
          />
        </div>
      </section>
    </div>
  )
}

function getCanvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
  const rect = event.currentTarget.getBoundingClientRect()
  const grid = 1
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const qx = Math.round(x / grid) * grid
  const qy = Math.round(y / grid) * grid
  return [qx, qy] as [number, number]
}
