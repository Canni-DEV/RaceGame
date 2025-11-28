import type {
  CarState,
  MissileState,
  RaceState,
  RoomState,
  TrackData,
} from '../core/trackTypes'
import type { PlayerSummary } from '../net/messages'

export interface RoomInfoSnapshot {
  roomId: string | null
  playerId: string | null
  track: TrackData | null
  players: PlayerSummary[]
}

type RoomInfoListener = (info: RoomInfoSnapshot) => void
type StateListener = (state: RoomState) => void

export class GameStateStore {
  private roomId: string | null = null
  private playerId: string | null = null
  private track: TrackData | null = null
  private players: PlayerSummary[] = []
  private lastState: RoomState | null = null
  private lastStateTimestamp = 0

  private readonly roomInfoListeners = new Set<RoomInfoListener>()
  private readonly stateListeners = new Set<StateListener>()

  setRoomInfo(
    roomId: string,
    playerId: string,
    track: TrackData,
    players: PlayerSummary[]
  ): void {
    this.roomId = roomId
    this.playerId = playerId
    this.track = track
    this.players = [...players]
    this.notifyRoomInfo()
  }

  updateState(roomState: RoomState): void {
    this.lastState = roomState
    this.lastStateTimestamp = performance.now()
    this.notifyState(roomState)
  }

  getTrack(): TrackData | null {
    return this.track
  }

  getRoomId(): string | null {
    return this.roomId
  }

  getPlayerId(): string | null {
    return this.playerId
  }

  getCarsForRender(_currentTime: number): CarState[] {
    return this.lastState?.cars ?? []
  }

  getMissilesForRender(_currentTime: number): MissileState[] {
    return this.lastState?.missiles ?? []
  }

  getRaceState(): RaceState | null {
    return this.lastState?.race ?? null
  }

  getLastStateTimestamp(): number {
    return this.lastStateTimestamp
  }

  onRoomInfo(listener: RoomInfoListener): () => void {
    this.roomInfoListeners.add(listener)
    if (this.roomId) {
      listener(this.getRoomInfoSnapshot())
    }
    return () => {
      this.roomInfoListeners.delete(listener)
    }
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    if (this.lastState) {
      listener(this.lastState)
    }
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  private notifyRoomInfo(): void {
    const snapshot = this.getRoomInfoSnapshot()
    for (const listener of this.roomInfoListeners) {
      listener(snapshot)
    }
  }

  private notifyState(state: RoomState): void {
    for (const listener of this.stateListeners) {
      listener(state)
    }
  }

  private getRoomInfoSnapshot(): RoomInfoSnapshot {
    return {
      roomId: this.roomId,
      playerId: this.playerId,
      track: this.track,
      players: [...this.players],
    }
  }
}
