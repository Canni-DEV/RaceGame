import type {
  CarState,
  ItemState,
  MissileState,
  RaceState,
  RoomState,
  RoomStateDelta,
  TrackData,
} from '../core/trackTypes'
import type { PlayerSummary } from '../net/messages'
import { applyRoomStateDelta } from './StateRebuilder'

type Snapshot = {
  state: RoomState
  serverTime: number
  receivedAt: number
}

const MAX_SNAPSHOTS = 120 // ~6s @ 20Hz
const OFFSET_SMOOTHING = 0.1
const MAX_EXTRAPOLATION = 0.05
const MAX_OFFSET_DELTA = 0.05

const DEFAULT_INTERPOLATION_DELAY_SECONDS = 0.06 // seconds to render in the past
const DEFAULT_MAX_RENDER_BACKSTEP_SECONDS = 0.01

export type InterpolationConfig = {
  interpolationDelaySeconds?: number
  maxRenderBackstepSeconds?: number
}

export interface RoomInfoSnapshot {
  roomId: string | null
  playerId: string | null
  track: TrackData | null
  players: PlayerSummary[]
  sessionToken?: string
  protocolVersion?: number
  serverVersion?: string
}

type RoomInfoListener = (info: RoomInfoSnapshot) => void
type StateListener = (state: RoomState) => void

export class GameStateStore {
  private roomId: string | null = null
  private playerId: string | null = null
  private track: TrackData | null = null
  private players: PlayerSummary[] = []
  private sessionToken: string | null = null
  private protocolVersion: number | null = null
  private serverVersion: string | null = null
  private lastState: RoomState | null = null
  private readonly snapshots: Snapshot[] = []
  private serverOffsetSeconds: number | null = null
  private lastRenderServerTime: number | null = null
  private interpolationDelaySeconds = DEFAULT_INTERPOLATION_DELAY_SECONDS
  private maxRenderBackstepSeconds = DEFAULT_MAX_RENDER_BACKSTEP_SECONDS

  private readonly roomInfoListeners = new Set<RoomInfoListener>()
  private readonly stateListeners = new Set<StateListener>()

  constructor(config?: InterpolationConfig) {
    if (config) {
      this.updateInterpolationConfig(config)
    }
  }

  setRoomInfo(
    roomId: string,
    playerId: string,
    track: TrackData,
    players: PlayerSummary[],
    info?: { sessionToken?: string; protocolVersion?: number; serverVersion?: string },
  ): void {
    const roomChanged = this.roomId !== null && this.roomId !== roomId
    const trackChanged = this.track !== null && this.track.id !== track.id
    if (roomChanged || trackChanged) {
      this.resetInterpolationState()
    }
    this.roomId = roomId
    this.playerId = playerId
    this.track = track
    this.replacePlayers(players)
    this.sessionToken = info?.sessionToken ?? null
    this.protocolVersion = info?.protocolVersion ?? null
    this.serverVersion = info?.serverVersion ?? null
    this.notifyRoomInfo()
  }

  updateState(roomState: RoomState): void {
    this.consumeState(roomState)
  }

  applyDelta(delta: RoomStateDelta): boolean {
    if (this.roomId && delta.roomId !== this.roomId) {
      return false
    }
    const merged = applyRoomStateDelta(this.lastState, delta)
    if (!merged) {
      return false
    }
    this.consumeState(merged)
    return true
  }

  updatePlayer(player: PlayerSummary): void {
    const updated = this.upsertPlayers([player])
    if (updated) {
      this.notifyRoomInfo()
    }
  }

  removePlayer(playerId: string): void {
    const nextPlayers = this.players.filter((player) => player.playerId !== playerId)
    if (nextPlayers.length === this.players.length) {
      return
    }
    this.players = nextPlayers
    this.notifyRoomInfo()
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

  getCarsForRender(currentTime: number): CarState[] {
    const interpolated = this.getInterpolatedState(currentTime)
    return interpolated?.cars ?? this.lastState?.cars ?? []
  }

  getMissilesForRender(currentTime: number): MissileState[] {
    const interpolated = this.getInterpolatedState(currentTime)
    return interpolated?.missiles ?? this.lastState?.missiles ?? []
  }

  getItemsForRender(currentTime: number): ItemState[] {
    const interpolated = this.getInterpolatedState(currentTime)
    return interpolated?.items ?? this.lastState?.items ?? []
  }

  getRaceState(): RaceState | null {
    const interpolated = this.getInterpolatedState(performance.now())
    return interpolated?.race ?? this.lastState?.race ?? null
  }

  updateInterpolationConfig(config: InterpolationConfig): void {
    const interpolationDelaySeconds = config.interpolationDelaySeconds
    if (typeof interpolationDelaySeconds === 'number' && Number.isFinite(interpolationDelaySeconds)) {
      this.interpolationDelaySeconds = Math.max(
        0,
        interpolationDelaySeconds,
      )
    }

    const maxRenderBackstepSeconds = config.maxRenderBackstepSeconds
    if (typeof maxRenderBackstepSeconds === 'number' && Number.isFinite(maxRenderBackstepSeconds)) {
      this.maxRenderBackstepSeconds = Math.max(
        0,
        maxRenderBackstepSeconds,
      )
    }
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

  private consumeState(roomState: RoomState): void {
    if (this.roomId && roomState.roomId !== this.roomId) {
      return
    }
    this.mergePlayersFromState(roomState)
    this.recordSnapshot(roomState)
    this.notifyState(roomState)
  }

  private recordSnapshot(state: RoomState): void {
    const now = performance.now()
    this.lastState = state
    if (!Number.isFinite(state.serverTime)) {
      return
    }
    this.updateServerOffset(now, state.serverTime)
    const snapshot: Snapshot = {
      state,
      serverTime: state.serverTime,
      receivedAt: now,
    }

    const existingIndex = this.snapshots.findIndex(
      (entry) => entry.serverTime === snapshot.serverTime,
    )
    if (existingIndex >= 0) {
      this.snapshots[existingIndex] = snapshot
    } else {
      const insertIndex = this.snapshots.findIndex(
        (entry) => entry.serverTime > snapshot.serverTime,
      )
      if (insertIndex === -1) {
        this.snapshots.push(snapshot)
      } else {
        this.snapshots.splice(insertIndex, 0, snapshot)
      }
      if (this.snapshots.length > MAX_SNAPSHOTS) {
        this.snapshots.shift()
      }
    }
  }

  private updateServerOffset(nowMs: number, serverTime: number): void {
    const nowSeconds = nowMs / 1000
    if (!Number.isFinite(serverTime) || !Number.isFinite(nowSeconds)) {
      return
    }
    const sample = nowSeconds - serverTime
    if (this.serverOffsetSeconds === null) {
      this.serverOffsetSeconds = sample
      return
    }
    const delta = sample - this.serverOffsetSeconds
    const clampedDelta = this.clamp(delta, -MAX_OFFSET_DELTA, MAX_OFFSET_DELTA)
    this.serverOffsetSeconds =
      this.serverOffsetSeconds + clampedDelta * OFFSET_SMOOTHING
  }

  private getRenderServerTime(nowMs: number): number | null {
    if (this.serverOffsetSeconds === null || !Number.isFinite(this.serverOffsetSeconds)) {
      return null
    }
    const nowSeconds = nowMs / 1000
    let target =
      nowSeconds - this.serverOffsetSeconds - this.interpolationDelaySeconds

    if (this.lastRenderServerTime !== null) {
      const maxBackstep =
        this.lastRenderServerTime - this.maxRenderBackstepSeconds
      target = Math.max(target, maxBackstep)
    }

    this.lastRenderServerTime = target
    return target
  }

  private getInterpolatedState(nowMs: number): RoomState | null {
    if (!this.lastState || this.snapshots.length === 0) {
      return this.lastState
    }

    const targetServerTime = this.getRenderServerTime(nowMs)
    if (targetServerTime === null) {
      return this.lastState
    }

    let previous: Snapshot | null = null
    let next: Snapshot | null = null

    for (const snapshot of this.snapshots) {
      if (snapshot.serverTime <= targetServerTime) {
        previous = snapshot
      }
      if (snapshot.serverTime >= targetServerTime) {
        next = snapshot
        break
      }
    }

    if (!previous) {
      return this.snapshots[0]?.state ?? this.lastState
    }

    if (!next) {
      return this.extrapolateState(previous, targetServerTime)
    }

    if (next === previous || next.serverTime === previous.serverTime) {
      return next.state
    }

    const alpha = this.clamp(
      (targetServerTime - previous.serverTime) /
        (next.serverTime - previous.serverTime),
      0,
      1,
    )

    return this.interpolateStates(previous.state, next.state, alpha, targetServerTime)
  }

  private interpolateStates(
    a: RoomState,
    b: RoomState,
    alpha: number,
    targetServerTime: number,
  ): RoomState {
    const carMap = new Map<string, CarState>()
    for (const car of a.cars) {
      carMap.set(car.playerId, car)
    }

    const mergedCars: CarState[] = []
    const nextCars = new Map<string, CarState>()
    for (const car of b.cars) {
      nextCars.set(car.playerId, car)
    }

    const allIds = new Set<string>([
      ...carMap.keys(),
      ...nextCars.keys(),
    ])

    for (const id of allIds) {
      const carA = carMap.get(id)
      const carB = nextCars.get(id)

      if (carA && carB) {
        mergedCars.push(this.interpolateCar(carA, carB, alpha))
      } else if (carB) {
        mergedCars.push({ ...carB })
      } else if (carA) {
        mergedCars.push({ ...carA })
      }
    }

    const missiles = this.interpolateEntities(
      a.missiles,
      b.missiles,
      (missile) => missile.id,
      alpha,
    )
    const items = this.interpolateEntities(
      a.items,
      b.items,
      (item) => item.id,
      alpha,
    )

    return {
      roomId: a.roomId,
      trackId: a.trackId,
      serverTime: targetServerTime,
      cars: mergedCars,
      missiles,
      items,
      radio: alpha < 0.5 ? a.radio : b.radio,
      race: alpha < 0.5 ? a.race : b.race,
    }
  }

  private extrapolateState(base: Snapshot, targetServerTime: number): RoomState {
    const dt = this.clamp(targetServerTime - base.serverTime, 0, MAX_EXTRAPOLATION)

    const cars = base.state.cars.map((car) => {
      const directionX = Math.cos(car.angle)
      const directionZ = Math.sin(car.angle)
      const delta = car.speed * dt
      return {
        ...car,
        x: car.x + directionX * delta,
        z: car.z + directionZ * delta,
      }
    })

    const missiles = base.state.missiles.map((missile) => {
      const dirX = Math.cos(missile.angle)
      const dirZ = Math.sin(missile.angle)
      const delta = missile.speed * dt
      return {
        ...missile,
        x: missile.x + dirX * delta,
        z: missile.z + dirZ * delta,
      }
    })

    return {
      ...base.state,
      serverTime: base.serverTime + dt,
      cars,
      missiles,
    }
  }

  private interpolateCar(a: CarState, b: CarState, alpha: number): CarState {
    const angle = this.interpolateAngle(a.angle, b.angle, alpha)
    return {
      playerId: a.playerId,
      username: alpha < 0.5 ? a.username : b.username,
      x: this.lerp(a.x, b.x, alpha),
      z: this.lerp(a.z, b.z, alpha),
      angle,
      speed: this.lerp(a.speed, b.speed, alpha),
      isNpc: a.isNpc ?? b.isNpc,
      turboActive: alpha < 0.5 ? a.turboActive : b.turboActive,
      turboCharges: this.lerp(a.turboCharges ?? 0, b.turboCharges ?? 0, alpha),
      turboRecharge: this.lerp(
        a.turboRecharge ?? 0,
        b.turboRecharge ?? 0,
        alpha,
      ),
      turboDurationLeft: this.lerp(
        a.turboDurationLeft ?? 0,
        b.turboDurationLeft ?? 0,
        alpha,
      ),
      missileCharges: this.lerp(
        a.missileCharges ?? 0,
        b.missileCharges ?? 0,
        alpha,
      ),
      missileRecharge: this.lerp(
        a.missileRecharge ?? 0,
        b.missileRecharge ?? 0,
        alpha,
      ),
      impactSpinTimeLeft: this.lerp(
        a.impactSpinTimeLeft ?? 0,
        b.impactSpinTimeLeft ?? 0,
        alpha,
      ),
    }
  }

  private interpolateEntities<T extends { id: string; x: number; z: number; angle: number }>(
    a: T[],
    b: T[],
    keySelector: (value: T) => string,
    alpha: number,
  ): T[] {
    const mapA = new Map<string, T>()
    for (const value of a) {
      mapA.set(keySelector(value), value)
    }
    const mapB = new Map<string, T>()
    for (const value of b) {
      mapB.set(keySelector(value), value)
    }

    const ids = new Set<string>([...mapA.keys(), ...mapB.keys()])
    const result: T[] = []

    for (const id of ids) {
      const valueA = mapA.get(id)
      const valueB = mapB.get(id)
      if (valueA && valueB) {
        result.push(this.interpolateGeneric(valueA, valueB, alpha))
      } else if (valueB) {
        result.push({ ...valueB })
      } else if (valueA) {
        result.push({ ...valueA })
      }
    }

    return result
  }

  private interpolateGeneric<T extends { x: number; z: number; angle: number }>(
    a: T,
    b: T,
    alpha: number,
  ): T {
    return {
      ...b,
      x: this.lerp(a.x, b.x, alpha),
      z: this.lerp(a.z, b.z, alpha),
      angle: this.interpolateAngle(a.angle, b.angle, alpha),
    }
  }

  private interpolateAngle(a: number, b: number, alpha: number): number {
    const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a))
    const interpolated = a + delta * alpha
    const twoPi = Math.PI * 2
    return ((interpolated % twoPi) + twoPi) % twoPi
  }

  private lerp(a: number, b: number, alpha: number): number {
    return a + (b - a) * alpha
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max)
  }

  private resetInterpolationState(): void {
    this.lastState = null
    this.snapshots.length = 0
    this.serverOffsetSeconds = null
    this.lastRenderServerTime = null
  }

  private getRoomInfoSnapshot(): RoomInfoSnapshot {
    return {
      roomId: this.roomId,
      playerId: this.playerId,
      track: this.track,
      players: [...this.players],
      sessionToken: this.sessionToken ?? undefined,
      protocolVersion: this.protocolVersion ?? undefined,
      serverVersion: this.serverVersion ?? undefined,
    }
  }

  private replacePlayers(players: PlayerSummary[]): void {
    this.players = players.map((player) => this.normalizePlayer(player))
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
    if (updated) {
      this.notifyRoomInfo()
    }
  }

  private upsertPlayers(updates: PlayerSummary[]): boolean {
    let changed = false
    for (const player of updates) {
      const normalized = this.normalizePlayer(player)
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
}
