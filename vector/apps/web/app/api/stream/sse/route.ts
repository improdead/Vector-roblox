export const runtime = 'nodejs'

import { getSince, subscribe } from '../../../../lib/store/stream'

const encoder = new TextEncoder()

function stringifyEvent(data: unknown): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const key = url.searchParams.get('workflowId') || url.searchParams.get('projectId')
  const cursorParam = Number(url.searchParams.get('cursor') || '0')
  if (!key) {
    return new Response(JSON.stringify({ error: 'Missing workflowId or projectId' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  let currentCursor = cursorParam

  let keepAlive: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const initial = getSince(key, currentCursor)
      currentCursor = initial.cursor
      controller.enqueue(stringifyEvent({ cursor: initial.cursor, chunks: initial.chunks }))

      unsubscribe = subscribe(key, (chunk) => {
        if (chunk.i <= currentCursor) return
        currentCursor = chunk.i
        controller.enqueue(stringifyEvent({ cursor: currentCursor, chunk }))
      })

      keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(': keep-alive\n\n'))
      }, 15000)

      const abort = (req as any).signal as AbortSignal | undefined
      if (abort) {
        if (abort.aborted) {
          if (keepAlive) clearInterval(keepAlive)
          if (unsubscribe) unsubscribe()
          controller.close()
          return
        }
        abort.addEventListener('abort', () => {
          if (keepAlive) clearInterval(keepAlive)
          if (unsubscribe) unsubscribe()
          controller.close()
        })
      }
    },
    cancel() {
      if (keepAlive) clearInterval(keepAlive)
      if (unsubscribe) unsubscribe()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  })
}
