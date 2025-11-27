import { SocketClient } from '../net/SocketClient'
import type { RoomInfoMessage, StateMessage } from '../net/messages'
import type { ControllerInput } from './ControllerInputStore'

type ControllerSocketOptions = {
  roomId: string
  playerId: string
  serverUrl?: string
}

type RoomInfoCallback = (info: RoomInfoMessage) => void

type ErrorCallback = (message: string) => void

type ConnectCallback = () => void

export class ControllerSocketClient {
  private readonly client: SocketClient
  private readonly roomId: string
  private readonly playerId: string

  constructor({ roomId, playerId, serverUrl }: ControllerSocketOptions) {
    this.roomId = roomId
    this.playerId = playerId
    this.client = new SocketClient(
      {
        role: 'controller',
        joinPayload: { roomId, playerId },
      },
      serverUrl,
    )
  }

  connect(): void {
    this.client.connect()
  }

  disconnect(): void {
    this.client.disconnect()
  }

  onRoomInfo(callback: RoomInfoCallback): () => void {
    return this.client.onRoomInfo(callback)
  }

  onError(callback: ErrorCallback): () => void {
    return this.client.onError(callback)
  }

  onConnect(callback: ConnectCallback): () => void {
    return this.client.onConnect(callback)
  }

  onState(callback: (state: StateMessage) => void): () => void {
    return this.client.onState(callback)
  }

  sendInput(input: ControllerInput): void {
    if (!this.roomId || !this.playerId) {
      return
    }
    if (!this.client.isConnected()) {
      return
    }
    this.client.emit('input', {
      roomId: this.roomId,
      playerId: this.playerId,
      steer: input.steer,
      throttle: input.throttle,
      brake: input.brake,
      actions: input.actions,
    })
  }
}
