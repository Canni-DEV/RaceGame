import * as THREE from 'three'
import { EngineSound } from './EngineSound'

export type PositionalSfxOptions = {
  volume?: number
  refDistance?: number
  rolloff?: number
  maxDistance?: number
}

type SfxRequest = {
  url: string
  volume: number
  position?: THREE.Vector3
  refDistance?: number
  rolloff?: number
  maxDistance?: number
}

export class AudioManager {
  private readonly listener: THREE.AudioListener
  private readonly audioRoot: THREE.Group
  private readonly unlockHandler: () => void
  private readonly engineSounds: Set<EngineSound> = new Set()
  private readonly stateChangeHandler: () => void
  private readonly stateListeners = new Set<
    (state: { userEnabled: boolean; contextRunning: boolean }) => void
  >()
  private readonly pendingActions: Array<() => void> = []
  private readonly bufferCache = new Map<string, AudioBuffer>()
  private readonly bufferLoads = new Map<string, Promise<AudioBuffer>>()
  private contextRunning = false
  private userEnabled = false

  constructor(camera: THREE.Camera, scene: THREE.Scene) {
    this.listener = new THREE.AudioListener()
    camera.add(this.listener)
    this.audioRoot = new THREE.Group()
    this.audioRoot.name = 'audio-root'
    scene.add(this.audioRoot)

    this.stateChangeHandler = () => {
      this.contextRunning = this.isContextRunning()
      this.notifyState()
      if (!this.contextRunning || !this.userEnabled) {
        return
      }
      this.startPendingSounds()
    }
    this.listener.context.addEventListener('statechange', this.stateChangeHandler)
    this.contextRunning = this.isContextRunning()

    this.unlockHandler = () => {
      if (this.contextRunning) {
        return
      }
      void this.listener.context
        .resume()
        .then(() => {
          if (this.isContextRunning()) {
            this.stateChangeHandler()
          }
        })
        .catch(() => {
          // Algunos navegadores rechazan el resume si no detectan gesto; el estado change listener reintentará.
        })
    }
  }

  toggle(): void {
    if (this.userEnabled) {
      this.userEnabled = false
      this.pendingActions.length = 0
      if (this.isContextRunning()) {
        void this.listener.context
          .suspend()
          .then(() => {
            this.contextRunning = false
          })
          .catch(() => {
            // Ignorado: algunos navegadores no permiten suspender en ciertos estados.
          })
      } else {
        this.contextRunning = false
      }
      this.notifyState()
      return
    }

    this.userEnabled = true
    this.contextRunning = this.isContextRunning()
    this.notifyState()
    if (this.contextRunning) {
      this.startPendingSounds()
      return
    }
    this.unlockHandler()
  }

  preload(urls: string[]): void {
    for (const url of urls) {
      void this.loadBuffer(url).catch(() => undefined)
    }
  }

  createEngineSound(): EngineSound {
    const sound = new EngineSound(this.listener, undefined, () => {
      this.engineSounds.delete(sound)
    })
    this.engineSounds.add(sound)
    this.startSoundIfReady(sound)
    return sound
  }

  playUiSound(url: string, volume = 1): void {
    if (!this.userEnabled) {
      return
    }
    this.enqueueOrRun(() => {
      void this.playOneShot({
        url,
        volume,
      })
    })
  }

  playPositionalSound(
    url: string,
    position: THREE.Vector3,
    options?: PositionalSfxOptions,
  ): void {
    if (!this.userEnabled) {
      return
    }
    const positionCopy = position.clone()
    this.enqueueOrRun(() => {
      void this.playOneShot({
        url,
        volume: options?.volume ?? 1,
        position: positionCopy,
        refDistance: options?.refDistance,
        rolloff: options?.rolloff,
        maxDistance: options?.maxDistance,
      })
    })
  }

  dispose(): void {
    this.listener.context.removeEventListener('statechange', this.stateChangeHandler)
    for (const sound of this.engineSounds) {
      sound.dispose()
    }
    this.engineSounds.clear()
    this.pendingActions.length = 0
    this.bufferCache.clear()
    this.bufferLoads.clear()
    this.audioRoot.removeFromParent()
    this.stateListeners.clear()
  }

  getListener(): THREE.AudioListener {
    return this.listener
  }

  onStateChange(
    listener: (state: { userEnabled: boolean; contextRunning: boolean }) => void,
  ): () => void {
    this.stateListeners.add(listener)
    listener({ userEnabled: this.userEnabled, contextRunning: this.contextRunning })
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  private startSoundIfReady(sound: EngineSound): void {
    if (!this.contextRunning || !this.userEnabled || sound.isDisposed()) {
      return
    }
    sound.start()
  }

  private startPendingSounds(): void {
    for (const sound of this.engineSounds) {
      this.startSoundIfReady(sound)
    }
    this.flushPendingActions()
  }

  private notifyState(): void {
    const snapshot = { userEnabled: this.userEnabled, contextRunning: this.contextRunning }
    for (const listener of this.stateListeners) {
      listener(snapshot)
    }
  }

  private isContextRunning(): boolean {
    return this.listener.context.state === 'running'
  }

  private enqueueOrRun(action: () => void): void {
    if (!this.userEnabled) {
      return
    }
    if (this.contextRunning) {
      action()
      return
    }
    this.pendingActions.push(action)
    this.unlockHandler()
  }

  private flushPendingActions(): void {
    if (!this.contextRunning || !this.userEnabled || this.pendingActions.length === 0) {
      return
    }
    const pending = this.pendingActions.splice(0)
    for (const action of pending) {
      action()
    }
  }

  private async loadBuffer(url: string): Promise<AudioBuffer> {
    const cached = this.bufferCache.get(url)
    if (cached) {
      return cached
    }
    const inflight = this.bufferLoads.get(url)
    if (inflight) {
      return inflight
    }
    const loadPromise = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Audio fetch failed (${response.status})`)
        }
        return response.arrayBuffer()
      })
      .then((data) => this.listener.context.decodeAudioData(data))
      .then((buffer) => {
        this.bufferCache.set(url, buffer)
        this.bufferLoads.delete(url)
        return buffer
      })
      .catch((error) => {
        this.bufferLoads.delete(url)
        console.warn('[Audio] Failed to load', url, error)
        throw error
      })
    this.bufferLoads.set(url, loadPromise)
    return loadPromise
  }

  private async playOneShot(request: SfxRequest): Promise<void> {
    if (!this.userEnabled) {
      return
    }
    let buffer: AudioBuffer
    try {
      buffer = await this.loadBuffer(request.url)
    } catch {
      return
    }

    if (!this.userEnabled) {
      return
    }
    if (!this.contextRunning) {
      this.pendingActions.push(() => {
        void this.playOneShot(request)
      })
      return
    }

    const sound = request.position
      ? new THREE.PositionalAudio(this.listener)
      : new THREE.Audio(this.listener)
    sound.setBuffer(buffer)
    sound.setLoop(false)
    sound.setVolume(request.volume)

    if (request.position) {
      const positional = sound as THREE.PositionalAudio
      if (typeof request.refDistance === 'number') {
        positional.setRefDistance(request.refDistance)
      }
      if (typeof request.rolloff === 'number') {
        positional.setRolloffFactor(request.rolloff)
      }
      positional.setDistanceModel('inverse')
      if (typeof request.maxDistance === 'number') {
        const panner = positional.getOutput() as PannerNode
        panner.maxDistance = request.maxDistance
      }
      positional.position.copy(request.position)
    }

    sound.onEnded = () => {
      sound.removeFromParent()
    }

    this.audioRoot.add(sound)
    sound.play()
  }
}
