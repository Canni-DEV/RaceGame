import type {
  ErrorMessage,
  PlayerEventMessage,
  RoomInfoMessage,
  StateDeltaMessage,
  StateFullMessage,
  StateMessage,
} from './messages'
import { PROTOCOL_VERSION, SERVER_URL } from '../config'

const SOCKET_SCRIPT_PATH = '/socket.io/socket.io.js'

type RoomInfoCallback = (info: RoomInfoMessage) => void
type StateCallback = (state: StateMessage) => void
type StateDeltaCallback = (delta: StateDeltaMessage) => void
type ErrorCallback = (message: string) => void
type ConnectCallback = () => void
type PlayerUpdateCallback = (player: PlayerEventMessage) => void

type SocketLike = {
  on(event: string, listener: (...args: unknown[]) => void): SocketLike
  emit(event: string, ...args: unknown[]): SocketLike
  connect(): SocketLike
  disconnect(): SocketLike
  removeAllListeners(): SocketLike
  connected: boolean
}

type SocketIoFactory = (url: string, options?: Record<string, unknown>) => SocketLike

declare global {
  interface Window {
    io?: SocketIoFactory
  }
}

let socketIoLoader: Promise<SocketIoFactory> | null = null

function loadSocketIo(baseUrl: string): Promise<SocketIoFactory> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('SocketClient requires a browser environment'))
  }

  if (window.io) {
    return Promise.resolve(window.io)
  }

  if (!socketIoLoader) {
    socketIoLoader = new Promise<SocketIoFactory>((resolve, reject) => {
      const script = document.createElement('script')
      const scriptUrl = new URL(SOCKET_SCRIPT_PATH, baseUrl).toString()
      script.src = scriptUrl
      script.async = true
      script.onload = () => {
        if (window.io) {
          resolve(window.io)
        } else {
          reject(new Error('Socket.IO client script loaded without exposing io()'))
        }
      }
      script.onerror = () => {
        reject(new Error(`Failed to load Socket.IO script from ${scriptUrl}`))
      }
      document.head.appendChild(script)
    })
  }

  return socketIoLoader
}

type SocketClientOptions = {
  role?: string
  joinPayload?: Record<string, unknown>
}

function sanitizeJoinPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) {
    return {}
  }
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined && value !== null) {
      sanitized[key] = value
    }
  }
  return sanitized
}

export class SocketClient {
  private socket: SocketLike | null = null
  private readonly url: string
  private readonly role: string
  private joinPayload: Record<string, unknown>
  private lastKnownRoomId: string | null = null
  private readonly roomInfoListeners = new Set<RoomInfoCallback>()
  private readonly stateListeners = new Set<StateCallback>()
  private readonly stateDeltaListeners = new Set<StateDeltaCallback>()
  private readonly errorListeners = new Set<ErrorCallback>()
  private readonly connectListeners = new Set<ConnectCallback>()
  private readonly playerUpdateListeners = new Set<PlayerUpdateCallback>()

  constructor(options?: SocketClientOptions, url?: string) {
    this.url = url ?? SERVER_URL
    this.role = options?.role ?? 'viewer'
    this.joinPayload = sanitizeJoinPayload(options?.joinPayload)
  }

  connect(): void {
    if (this.socket) {
      if (!this.socket.connected) {
        this.socket.connect()
      }
      return
    }

    loadSocketIo(this.url)
      .then((factory) => {
        if (this.socket) {
          return
        }

        const socket = factory(this.url, { transports: ['websocket'] })
        this.socket = socket
        this.registerHandlers(socket)
      })
      .catch((error) => {
        console.error('[SocketClient] Unable to initialize Socket.IO client', error)
      })
  }

  disconnect(): void {
    if (!this.socket) {
      return
    }
    this.socket.removeAllListeners()
    this.socket.disconnect()
    this.socket = null
  }

  onRoomInfo(callback: RoomInfoCallback): () => void {
    this.roomInfoListeners.add(callback)
    return () => {
      this.roomInfoListeners.delete(callback)
    }
  }

  onState(callback: StateCallback): () => void {
    this.stateListeners.add(callback)
    return () => {
      this.stateListeners.delete(callback)
    }
  }

  onStateDelta(callback: StateDeltaCallback): () => void {
    this.stateDeltaListeners.add(callback)
    return () => {
      this.stateDeltaListeners.delete(callback)
    }
  }

  onError(callback: ErrorCallback): () => void {
    this.errorListeners.add(callback)
    return () => {
      this.errorListeners.delete(callback)
    }
  }

  onConnect(callback: ConnectCallback): () => void {
    this.connectListeners.add(callback)
    return () => {
      this.connectListeners.delete(callback)
    }
  }

  onPlayerUpdate(callback: PlayerUpdateCallback): () => void {
    this.playerUpdateListeners.add(callback)
    return () => {
      this.playerUpdateListeners.delete(callback)
    }
  }

  setJoinPayload(payload: Record<string, unknown>): void {
    this.joinPayload = sanitizeJoinPayload(payload)
    if (this.socket?.connected) {
      this.socket.emit('join_room', this.buildJoinPayload())
    }
  }

  emit(event: string, payload: unknown): void {
    if (!this.socket) {
      console.warn(`[SocketClient] Cannot emit ${event} - socket not connected`)
      return
    }
    this.socket.emit(event, payload)
  }

  isConnected(): boolean {
    return Boolean(this.socket?.connected)
  }

  requestStateFull(roomId?: string): void {
    if (!this.socket || !this.socket.connected) {
      return
    }
    const joinRoomId = typeof this.joinPayload.roomId === 'string' ? (this.joinPayload.roomId as string) : null
    const targetRoomId = roomId ?? this.lastKnownRoomId ?? joinRoomId
    if (!targetRoomId) {
      return
    }
    this.socket.emit('request_state_full', { roomId: targetRoomId })
  }

  private registerHandlers(socket: SocketLike): void {
    socket.on('connect', () => {
      socket.emit('join_room', this.buildJoinPayload())
      for (const listener of this.connectListeners) {
        listener()
      }
    })

    socket.on('room_info', (info: unknown) => {
      const payload = info as RoomInfoMessage
      this.lastKnownRoomId = payload?.roomId ?? this.lastKnownRoomId
      for (const listener of this.roomInfoListeners) {
        listener(payload)
      }
    })

    const dispatchState = (state: unknown) => {
      const payload = state as StateFullMessage
      for (const listener of this.stateListeners) {
        listener(payload)
      }
    }

    socket.on('state', dispatchState)
    socket.on('state_full', dispatchState)

    socket.on('state_delta', (delta: unknown) => {
      const payload = delta as StateDeltaMessage
      for (const listener of this.stateDeltaListeners) {
        listener(payload)
      }
    })

    const dispatchPlayerUpdate = (event: unknown) => {
      const payload = event as PlayerEventMessage
      for (const listener of this.playerUpdateListeners) {
        listener(payload)
      }
    }

    socket.on('player_updated', dispatchPlayerUpdate)
    socket.on('player_joined', dispatchPlayerUpdate)

    socket.on('error_message', (error: unknown) => {
      const payload = error as ErrorMessage
      const message = payload?.message ?? 'Unknown error from server'
      for (const listener of this.errorListeners) {
        listener(message)
      }
      console.error(`[SocketClient] ${message}`)
    })

    socket.on('disconnect', (reason: unknown) => {
      console.warn(`[SocketClient] disconnected: ${String(reason)}`)
    })
  }

  private buildJoinPayload(): Record<string, unknown> {
    return { role: this.role, protocolVersion: PROTOCOL_VERSION, ...this.joinPayload }
  }
}
