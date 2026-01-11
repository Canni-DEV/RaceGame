import * as THREE from 'three'
import type { RoomRadioState, RoomState } from '../core/trackTypes'
import type { GameStateStore } from '../state/GameStateStore'
import { AudioManager } from '../audio/AudioManager'
import { RadioStream } from '../audio/RadioStream'
import { RADIO_STATIONS, type RadioStation } from '../audio/radioStations'
import { SocketClient } from '../net/SocketClient'

type RadioConfig = {
  offset: THREE.Vector3
  hitRadius: number
  volume: number
  refDistance: number
  rolloff: number
  maxDistance: number
  nodeName: string | null
}

const ROOM_MODEL_NAME = 'room-model'

const getNumberEnv = (key: string, fallback: number): number => {
  const raw = import.meta.env?.[key]
  if (typeof raw !== 'string') {
    return fallback
  }
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

const getStringEnv = (key: string, fallback: string): string | null => {
  const raw = import.meta.env?.[key]
  if (typeof raw !== 'string') {
    return fallback
  }
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

const getRadioConfig = (): RadioConfig => ({
  offset: new THREE.Vector3(
    getNumberEnv('VITE_ROOM_RADIO_OFFSET_X', 0),
    getNumberEnv('VITE_ROOM_RADIO_OFFSET_Y', 0),
    getNumberEnv('VITE_ROOM_RADIO_OFFSET_Z', 0),
  ),
  hitRadius: getNumberEnv('VITE_ROOM_RADIO_HIT_RADIUS', 250),
  volume: getNumberEnv('VITE_ROOM_RADIO_VOLUME', 2),
  refDistance: getNumberEnv('VITE_ROOM_RADIO_REF_DISTANCE', 200),
  rolloff: getNumberEnv('VITE_ROOM_RADIO_ROLLOFF', 1.1),
  maxDistance: getNumberEnv('VITE_ROOM_RADIO_MAX_DISTANCE', 120),
  nodeName: getStringEnv('VITE_ROOM_RADIO_NODE', 'Sketchfab_model.003'),
})

export class RadioSystem {
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera
  private readonly store: GameStateStore
  private readonly socketClient: SocketClient
  private readonly stations: RadioStation[]
  private readonly config: RadioConfig
  private readonly radioStream: RadioStream
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointerNdc = new THREE.Vector2()
  private anchor: THREE.Object3D | null = null
  private radioTarget: THREE.Object3D | null = null
  private radioState: RoomRadioState | null = null
  private userEnabled = false
  private audioEnabled = false
  private lastUrl: string | null = null
  private lastShouldPlay = false

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    audioManager: AudioManager,
    store: GameStateStore,
    socketClient: SocketClient,
    stations: RadioStation[] = RADIO_STATIONS,
  ) {
    this.scene = scene
    this.camera = camera
    this.store = store
    this.socketClient = socketClient
    this.stations = stations
    this.config = getRadioConfig()
    this.radioStream = new RadioStream(audioManager.getListener(), {
      volume: this.config.volume,
      refDistance: this.config.refDistance,
      rolloff: this.config.rolloff,
      maxDistance: this.config.maxDistance,
    })

    audioManager.onStateChange(this.handleAudioState)
    this.store.onState(this.handleState)
  }

  update(): void {
    this.ensureAnchor()
    this.syncPlayback()
  }

  handlePointerClick(event: PointerEvent, canvas: HTMLCanvasElement): void {
    if (!this.userEnabled) {
      return
    }
    if (!this.radioTarget) {
      return
    }
    const rect = canvas.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    this.pointerNdc.set(x, y)
    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    const hits = this.raycaster.intersectObject(this.radioTarget, true)
    if (hits.length === 0) {
      return
    }
    const roomId = this.store.getRoomId()
    this.socketClient.emit('radio_cycle', { roomId: roomId ?? undefined })
  }

  private readonly handleAudioState = (state: {
    userEnabled: boolean
    contextRunning: boolean
  }): void => {
    this.userEnabled = state.userEnabled
    this.audioEnabled = state.userEnabled && state.contextRunning
    this.syncPlayback()
  }

  private readonly handleState = (state: RoomState): void => {
    this.radioState = state.radio
    this.syncPlayback()
  }

  private syncPlayback(): void {
    const stationUrl = this.resolveStationUrl(this.radioState)
    const shouldPlay = Boolean(
      stationUrl &&
      this.audioEnabled &&
      this.anchor &&
      this.isInScene(this.anchor) &&
      this.radioState?.enabled,
    )

    if (stationUrl === this.lastUrl && shouldPlay === this.lastShouldPlay) {
      return
    }

    this.lastUrl = stationUrl
    this.lastShouldPlay = shouldPlay
    this.radioStream.setTarget(stationUrl, shouldPlay)
  }

  private resolveStationUrl(state: RoomRadioState | null): string | null {
    if (!state || !state.enabled) {
      return null
    }
    const index = state.stationIndex
    if (index < 0 || index >= this.stations.length) {
      return null
    }
    return this.stations[index].url
  }

  private ensureAnchor(): void {
    if (this.anchor && this.isInScene(this.anchor)) {
      return
    }
    this.anchor = null
    this.radioTarget = null

    const roomModel = this.scene.getObjectByName(ROOM_MODEL_NAME)
    if (!roomModel) {
      return
    }

    const anchor = this.resolveAnchor(roomModel)
    this.anchor = anchor
    this.radioStream.attachTo(anchor)
    this.radioTarget = this.resolveClickTarget(anchor, roomModel)
  }

  private isInScene(object: THREE.Object3D): boolean {
    let current: THREE.Object3D | null = object
    while (current) {
      if (current === this.scene) {
        return true
      }
      current = current.parent
    }
    return false
  }

  private resolveAnchor(roomModel: THREE.Object3D): THREE.Object3D {
    const namedNode = this.findNamedNode(roomModel)
    if (namedNode) {
      return namedNode
    }

    const anchor = new THREE.Object3D()
    anchor.name = 'room-radio-anchor'
    anchor.position.copy(this.config.offset)
    roomModel.add(anchor)
    return anchor
  }

  private findNamedNode(roomModel: THREE.Object3D): THREE.Object3D | null {
    if (this.config.nodeName) {
      const node = roomModel.getObjectByName(this.config.nodeName)
      if (node) {
        return node
      }
    }

    let match: THREE.Object3D | null = null
    roomModel.traverse((child) => {
      if (match) {
        return
      }
      if (child.name && child.name.toLowerCase().includes('radio')) {
        match = child
      }
    })
    return match
  }

  private resolveClickTarget(anchor: THREE.Object3D, roomModel: THREE.Object3D): THREE.Object3D {
    let hasMesh = false
    anchor.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        hasMesh = true
      }
    })
    if (hasMesh) {
      return anchor
    }

    const geometry = new THREE.SphereGeometry(1, 12, 12)
    const material = new THREE.MeshBasicMaterial() as THREE.MeshBasicMaterial & {
      transparent: boolean
      opacity: number
    }
    material.transparent = true
    material.opacity = 0

    const target = new THREE.Mesh(geometry, material)
    target.name = 'room-radio-hit'
    target.userData.isRadioHitTarget = true

    const baseScale = roomModel.scale.x || 1
    const inverseScale = baseScale !== 0 ? 1 / baseScale : 1
    target.scale.setScalar(this.config.hitRadius * inverseScale)
    anchor.add(target)
    return target
  }
}
