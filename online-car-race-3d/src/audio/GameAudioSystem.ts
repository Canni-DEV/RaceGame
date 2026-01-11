import * as THREE from 'three'
import type { RacePhase, RaceState, RoomState } from '../core/trackTypes'
import type { RoomInfoSnapshot } from '../state/GameStateStore'
import type { GameStateStore } from '../state/GameStateStore'
import { TRACK_SURFACE_HEIGHT } from '../render/TrackMeshBuilder'
import { AudioManager, type PositionalSfxOptions } from './AudioManager'
import {
  SFX_DEFINITIONS,
  type SfxId,
  resolveSfxUrl,
} from './sfxCatalog'

const CAR_AUDIO_HEIGHT = TRACK_SURFACE_HEIGHT + 0.82
const ITEM_AUDIO_HEIGHT = TRACK_SURFACE_HEIGHT + 1.05
const MISSILE_AUDIO_HEIGHT = TRACK_SURFACE_HEIGHT + 0.9

export class GameAudioSystem {
  private readonly audioManager: AudioManager
  private readonly store: GameStateStore
  private readonly sfxUrls = new Map<SfxId, string>()
  private readonly tempPosition = new THREE.Vector3()
  private lastItems = new Map<string, { x: number; z: number; type: string }>()
  private lastMissileIds = new Set<string>()
  private lastTurboActive = new Map<string, boolean>()
  private lastLaps = new Map<string, number>()
  private lastCountdownTick: number | null = null
  private lastRacePhase: RacePhase | null = null
  private lastTrackId: string | null = null
  private playerId: string | null = null
  private playersSeen = new Set<string>()
  private hasPlayerSnapshot = false
  private hasState = false
  private readonly unsubscribeRoomInfo: () => void
  private readonly unsubscribeState: () => void

  constructor(audioManager: AudioManager, store: GameStateStore) {
    this.audioManager = audioManager
    this.store = store
    this.prepareSfxUrls()
    this.audioManager.preload([...this.sfxUrls.values()])

    this.unsubscribeRoomInfo = this.store.onRoomInfo(this.handleRoomInfo)
    this.unsubscribeState = this.store.onState(this.handleState)
  }

  private prepareSfxUrls(): void {
    for (const def of Object.values(SFX_DEFINITIONS)) {
      this.sfxUrls.set(def.id, resolveSfxUrl(def.file))
    }
  }

  private handleRoomInfo = (info: RoomInfoSnapshot): void => {
    if (info.playerId !== this.playerId) {
      this.playerId = info.playerId
      this.lastLaps.clear()
    }
    this.handlePlayerList(info)
  }

  private handlePlayerList(info: RoomInfoSnapshot): void {
    const nextPlayers = new Set<string>()
    for (const player of info.players) {
      nextPlayers.add(player.playerId)
      if (player.isNpc) {
        continue
      }
      if (this.hasPlayerSnapshot && !this.playersSeen.has(player.playerId)) {
        this.playUi('player-join')
      }
    }

    this.playersSeen = nextPlayers
    this.hasPlayerSnapshot = true
  }

  private handleState = (state: RoomState): void => {
    if (this.lastTrackId && state.trackId !== this.lastTrackId) {
      this.resetStateCaches()
    }
    this.lastTrackId = state.trackId

    this.handleCountdown(state.race)
    this.handleLap(state.race)
    this.handleItems(state)
    this.handleMissiles(state)
    this.handleTurbo(state)

    this.lastRacePhase = state.race.phase
    this.hasState = true
  }

  private handleItems(state: RoomState): void {
    const nextItems = new Map<string, { x: number; z: number; type: string }>()
    for (const item of state.items) {
      nextItems.set(item.id, { x: item.x, z: item.z, type: item.type })
    }

    if (this.hasState) {
      for (const [itemId, prev] of this.lastItems.entries()) {
        if (!nextItems.has(itemId)) {
          const sfxId = prev.type === 'nitro' ? 'pickup-turbo' : 'pickup-missile'
          this.playPositional(
            sfxId,
            this.tempPosition.set(prev.x, ITEM_AUDIO_HEIGHT, prev.z),
          )
        }
      }
    }

    this.lastItems = nextItems
  }

  private handleMissiles(state: RoomState): void {
    const nextMissiles = new Set<string>()
    for (const missile of state.missiles) {
      nextMissiles.add(missile.id)
      if (this.hasState && !this.lastMissileIds.has(missile.id)) {
        this.playPositional(
          'missile-fire',
          this.tempPosition.set(missile.x, MISSILE_AUDIO_HEIGHT, missile.z),
        )
      }
    }

    this.lastMissileIds = nextMissiles
  }

  private handleTurbo(state: RoomState): void {
    const activePlayers = new Set<string>()
    for (const car of state.cars) {
      activePlayers.add(car.playerId)
      const wasActive = this.lastTurboActive.get(car.playerId) ?? false
      const isActive = Boolean(car.turboActive)
      if (this.hasState && !wasActive && isActive) {
        this.playPositional(
          'turbo-activate',
          this.tempPosition.set(car.x, CAR_AUDIO_HEIGHT, car.z),
        )
      }
      this.lastTurboActive.set(car.playerId, isActive)
    }

    for (const playerId of this.lastTurboActive.keys()) {
      if (!activePlayers.has(playerId)) {
        this.lastTurboActive.delete(playerId)
      }
    }
  }

  private handleLap(race: RaceState): void {
    const localPlayer = this.playerId
      ? race.players.find((entry) => entry.playerId === this.playerId)
      : null
    const previousLap = localPlayer
      ? this.lastLaps.get(localPlayer.playerId)
      : undefined

    if (
      this.hasState &&
      race.phase === 'race' &&
      localPlayer &&
      previousLap !== undefined &&
      localPlayer.lap > previousLap
    ) {
      this.playUi('lap-complete')
    }

    for (const player of race.players) {
      this.lastLaps.set(player.playerId, player.lap)
    }
  }

  private handleCountdown(race: RaceState): void {
    if (this.hasState && this.lastRacePhase === 'countdown' && race.phase === 'race') {
      this.playUi('countdown-go')
    }

    if (race.phase !== 'countdown') {
      this.lastCountdownTick = null
      return
    }

    if (race.countdownRemaining === null) {
      return
    }

    const tick = Math.ceil(race.countdownRemaining)
    const enteringCountdown = this.lastRacePhase !== 'countdown'
    if (this.lastCountdownTick === null) {
      if (this.hasState && enteringCountdown && tick > 0) {
        this.playUi('countdown-tick')
      }
      this.lastCountdownTick = tick
      return
    }

    if (this.hasState && tick !== this.lastCountdownTick && tick > 0) {
      this.playUi('countdown-tick')
    }
    this.lastCountdownTick = tick
  }

  private playPositional(id: SfxId, position: THREE.Vector3): void {
    const def = SFX_DEFINITIONS[id]
    const url = this.sfxUrls.get(id)
    if (!url || !def.positional) {
      return
    }

    const options: PositionalSfxOptions = {
      volume: def.volume,
      refDistance: def.refDistance,
      rolloff: def.rolloff,
      maxDistance: def.maxDistance,
    }
    this.audioManager.playPositionalSound(url, position, options)
  }

  private playUi(id: SfxId): void {
    const def = SFX_DEFINITIONS[id]
    const url = this.sfxUrls.get(id)
    if (!url) {
      return
    }
    this.audioManager.playUiSound(url, def.volume)
  }

  private resetStateCaches(): void {
    this.lastItems.clear()
    this.lastMissileIds.clear()
    this.lastTurboActive.clear()
    this.lastLaps.clear()
    this.lastCountdownTick = null
    this.lastRacePhase = null
    this.hasState = false
  }

  dispose(): void {
    this.unsubscribeRoomInfo()
    this.unsubscribeState()
    this.resetStateCaches()
    this.playersSeen.clear()
    this.hasPlayerSnapshot = false
  }
}
