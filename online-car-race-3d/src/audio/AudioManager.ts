import * as THREE from 'three'
import { EngineSound } from './EngineSound'

export class AudioManager {
  private readonly listener: THREE.AudioListener
  private readonly unlockHandler: () => void
  private readonly keydownHandler: (event: KeyboardEvent) => void
  private readonly engineSounds: Set<EngineSound> = new Set()
  private readonly stateChangeHandler: () => void
  private contextRunning = false
  private debugPlayed = false

  constructor(camera: THREE.Camera) {
    this.listener = new THREE.AudioListener()
    camera.add(this.listener)

    this.stateChangeHandler = () => {
      if (!this.isContextRunning()) {
        return
      }
      this.contextRunning = true
      this.startPendingSounds()
      this.playDebugChime()
      this.teardownUnlockListeners()
    }
    this.listener.context.addEventListener('statechange', this.stateChangeHandler)
    if (this.isContextRunning()) {
      this.contextRunning = true
      this.startPendingSounds()
      this.playDebugChime()
      this.teardownUnlockListeners()
    }

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

    this.keydownHandler = (event: KeyboardEvent) => {
      const key = event.key?.toLowerCase()
      if (key === 's') {
        this.unlockHandler()
      }
    }

    document.addEventListener('keydown', this.keydownHandler)
  }

  enable(): void {
    this.unlockHandler()
  }

  createEngineSound(): EngineSound {
    const sound = new EngineSound(this.listener, undefined, () => {
      this.engineSounds.delete(sound)
    })
    this.engineSounds.add(sound)
    this.startSoundIfReady(sound)
    return sound
  }

  dispose(): void {
    document.removeEventListener('keydown', this.keydownHandler)
    this.listener.context.removeEventListener('statechange', this.stateChangeHandler)
  }

  private startSoundIfReady(sound: EngineSound): void {
    if (!this.contextRunning || sound.isDisposed()) {
      return
    }
    sound.start()
  }

  private startPendingSounds(): void {
    for (const sound of this.engineSounds) {
      this.startSoundIfReady(sound)
    }
  }

  private teardownUnlockListeners(): void {
    document.removeEventListener('keydown', this.keydownHandler)
  }

  private isContextRunning(): boolean {
    return this.listener.context.state === 'running'
  }

  private playDebugChime(): void {
    if (this.debugPlayed) {
      return
    }
    this.debugPlayed = true
    console.info('[Audio] Debug chime')
    const ctx = this.listener.context
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 660
    gain.gain.value = 0.18
    osc.connect(gain)
    gain.connect(ctx.destination)
    const now = ctx.currentTime
    osc.start(now)
    osc.stop(now + 0.25)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
  }
}
