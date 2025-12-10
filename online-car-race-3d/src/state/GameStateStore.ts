import type {
  CarState,
  ItemState,
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
  private readonly playerNames = new Map<string, string>()
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
    this.replacePlayers(players)
    this.notifyRoomInfo()
  }

  updateState(roomState: RoomState): void {
    this.mergePlayersFromState(roomState)
    this.lastState = roomState
    this.lastStateTimestamp = performance.now()
    this.notifyState(roomState)
  }

  updatePlayer(player: PlayerSummary): void {
    const updated = this.upsertPlayers([player])
    if (updated) {
      this.notifyRoomInfo()
    }
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

  getItemsForRender(_currentTime: number): ItemState[] {
    return this.lastState?.items ?? []
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

  private replacePlayers(players: PlayerSummary[]): void {
    this.players = players.map((player) => this.normalizePlayer(player))
    this.refreshPlayerNames(this.players)
  }

  private mergePlayersFromState(roomState: RoomState): void {
    const updates: PlayerSummary[] = []
    for (const car of roomState.cars) {
      updates.push({
        playerId: car.playerId,
        username: car.username ?? car.playerId,
        isNpc: car.isNpc,
      })
    }

    for (const player of roomState.race.players) {
      updates.push({
        playerId: player.playerId,
        username: player.username ?? player.playerId,
        isNpc: player.isNpc,
      })
    }

    const updated = this.upsertPlayers(updates)
    const seenIds = new Set(updates.map((player) => player.playerId))
    const filtered = this.players.filter((player) => seenIds.has(player.playerId))
    const removed = filtered.length !== this.players.length
    if (removed) {
      this.players = filtered
      this.refreshPlayerNames(this.players)
    }
    if (updated) {
      this.notifyRoomInfo()
    } else if (removed) {
      this.notifyRoomInfo()
    }
  }

  private upsertPlayers(updates: PlayerSummary[]): boolean {
    let changed = false
    for (const player of updates) {
      const normalized = this.normalizePlayer(player)
      this.playerNames.set(normalized.playerId, normalized.username)
      const index = this.players.findIndex((p) => p.playerId === normalized.playerId)
      if (index >= 0) {
        const existing = this.players[index]
        if (
          existing.username !== normalized.username ||
          existing.isNpc !== normalized.isNpc
        ) {
          this.players[index] = { ...existing, ...normalized }
          changed = true
        }
      } else {
        this.players.push(normalized)
        changed = true
      }
    }
    return changed
  }

  private normalizePlayer(player: PlayerSummary): PlayerSummary {
    return {
      ...player,
      username: player.username || player.playerId,
    }
  }

  private refreshPlayerNames(players: PlayerSummary[]): void {
    this.playerNames.clear()
    for (const player of players) {
      this.playerNames.set(player.playerId, player.username || player.playerId)
    }
  }
}
