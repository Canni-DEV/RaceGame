import * as THREE from 'three'
import { EngineSound } from './EngineSound'

export class AudioManager {
  private readonly listener: THREE.AudioListener
  private readonly unlockHandler: () => void
  private readonly engineSounds: Set<EngineSound> = new Set()
  private readonly stateChangeHandler: () => void
  private contextRunning = false

  constructor(camera: THREE.Camera) {
    this.listener = new THREE.AudioListener()
    camera.add(this.listener)

    this.stateChangeHandler = () => {
      this.contextRunning = this.isContextRunning()
      if (!this.contextRunning) {
        return
      }
      this.startPendingSounds()
    }
    this.listener.context.addEventListener('statechange', this.stateChangeHandler)
    if (this.isContextRunning()) {
      this.contextRunning = true
      this.startPendingSounds()
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
  }

  toggle(): void {
    if (this.isContextRunning()) {
      void this.listener.context
        .suspend()
        .then(() => {
          this.contextRunning = false
        })
        .catch(() => {
          // Ignorado: algunos navegadores no permiten suspender en ciertos estados.
        })
      return
    }
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

  private isContextRunning(): boolean {
    return this.listener.context.state === 'running'
  }
}
