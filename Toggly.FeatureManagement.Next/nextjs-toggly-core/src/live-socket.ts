/**
 * Minimal WebSocket surface used for definitions live sync.
 * Supports browser/undici WHATWG sockets and the `ws` package.
 */
export type WebSocketConstructor = new (url: string) => unknown

export type LiveSocketHandlers = {
  onOpen: () => void
  onMessage: (data: string) => void
  onClose: () => void
  onError: () => void
}

export type LiveSocket = {
  close: () => void
}

function isEventEmitterSocket(
  socket: unknown,
): socket is {
  on: (event: string, listener: (...args: unknown[]) => void) => void
  close: () => void
  removeAllListeners?: () => void
} {
  return (
    typeof socket === 'object' &&
    socket !== null &&
    typeof (socket as { on?: unknown }).on === 'function' &&
    typeof (socket as { close?: unknown }).close === 'function'
  )
}

function isBrowserStyleSocket(
  socket: unknown,
): socket is {
  onopen: ((ev: Event) => void) | null
  onmessage: ((ev: MessageEvent) => void) | null
  onclose: ((ev: CloseEvent) => void) | null
  onerror: ((ev: Event) => void) | null
  close: () => void
} {
  return (
    typeof socket === 'object' &&
    socket !== null &&
    typeof (socket as { close?: unknown }).close === 'function' &&
    'onmessage' in socket
  )
}

/**
 * Resolve a WebSocket constructor: explicit config, then globalThis.
 */
export function resolveWebSocketConstructor(
  explicit?: WebSocketConstructor | null,
): WebSocketConstructor | null {
  if (explicit) {
    return explicit
  }
  const globalCtor = (globalThis as { WebSocket?: WebSocketConstructor }).WebSocket
  return globalCtor ?? null
}

/**
 * Open a live-update socket with a unified handler API.
 */
export function openLiveSocket(
  url: string,
  ctor: WebSocketConstructor,
  handlers: LiveSocketHandlers,
): LiveSocket {
  const socket = new ctor(url)

  // Prefer EventEmitter (`ws`) when available. The `ws` package also exposes
  // onmessage for browser compat, which would otherwise match the WHATWG path.
  if (isEventEmitterSocket(socket)) {
    socket.on('open', () => handlers.onOpen())
    socket.on('message', (data: unknown) => {
      if (typeof data === 'string') {
        handlers.onMessage(data)
        return
      }
      if (data instanceof ArrayBuffer) {
        handlers.onMessage(new TextDecoder().decode(data))
        return
      }
      if (ArrayBuffer.isView(data)) {
        handlers.onMessage(
          new TextDecoder().decode(data as ArrayBufferView),
        )
        return
      }
      // `ws` typically yields Buffer (Node)
      if (
        typeof Buffer !== 'undefined' &&
        Buffer.isBuffer(data)
      ) {
        handlers.onMessage(data.toString('utf8'))
        return
      }
      handlers.onMessage(String(data))
    })
    socket.on('close', () => handlers.onClose())
    socket.on('error', () => handlers.onError())
    return {
      close: () => {
        try {
          // Detach first so intentional stop does not fire onClose/reconnect.
          socket.removeAllListeners?.()
          // Keep a sink so premature-close errors from `ws` are not uncaught.
          socket.on('error', () => {})
          socket.close()
        } catch {
          // ignore
        }
      },
    }
  }

  if (isBrowserStyleSocket(socket)) {
    socket.onopen = () => handlers.onOpen()
    socket.onmessage = (event: MessageEvent) => {
      const data = event.data
      if (typeof data === 'string') {
        handlers.onMessage(data)
      } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
        void data.text().then((text) => handlers.onMessage(text)).catch(() => {
          // ignore binary decode failures
        })
      } else if (data != null) {
        handlers.onMessage(String(data))
      }
    }
    socket.onclose = () => handlers.onClose()
    socket.onerror = () => handlers.onError()
    return {
      close: () => {
        try {
          socket.onopen = null
          socket.onmessage = null
          socket.onclose = null
          socket.onerror = null
          socket.close()
        } catch {
          // ignore
        }
      },
    }
  }

  throw new Error('[Toggly] Unsupported WebSocket implementation')
}

/**
 * Handle a text frame from the definitions live channel.
 */
export function dispatchLiveMessage(
  data: string,
  handlers: {
    onPlainUpdate: () => void
    onSync: (message: import('./ws-sync').WsSyncMessage) => void
    onUpdate: (message: import('./ws-sync').WsSyncMessage) => void
  },
): void {
  if (data === 'update' || data === 'flags-updated') {
    handlers.onPlainUpdate()
    return
  }

  try {
    const message = JSON.parse(data) as import('./ws-sync').WsSyncMessage
    if (message.type === 'ping') {
      return
    }
    if (message.type === 'sync') {
      handlers.onSync(message)
      return
    }
    if (
      message.type === 'flags-updated' ||
      message.type === 'update' ||
      message.type === 'signing-key-updated'
    ) {
      handlers.onUpdate(message)
    }
  } catch {
    // Unrecognized message, ignore
  }
}
