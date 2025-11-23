import * as THREE from 'three'
import { EngineSound } from './EngineSound'

export class AudioManager {
  private readonly listener: THREE.AudioListener
  private readonly unlockHandler: () => void
  private readonly keydownHandler: (event: KeyboardEvent) => void
  private contextUnlocked = false

  constructor(camera: THREE.Camera) {
    this.listener = new THREE.AudioListener()
    camera.add(this.listener)

    this.unlockHandler = () => {
      if (this.contextUnlocked) {
        return
      }
      void this.listener.context.resume().then(() => {
        this.contextUnlocked = this.listener.context.state === 'running'
        if (this.contextUnlocked) {
          document.removeEventListener('pointerdown', this.unlockHandler)
          document.removeEventListener('keydown', this.keydownHandler)
        }
      })
    }

    this.keydownHandler = (event: KeyboardEvent) => {
      const key = event.key?.toLowerCase()
      if (key === 's') {
        this.unlockHandler()
      }
    }

    document.addEventListener('pointerdown', this.unlockHandler, { passive: true })
    document.addEventListener('keydown', this.keydownHandler)
  }

  enable(): void {
    this.unlockHandler()
  }

  createEngineSound(): EngineSound {
    return new EngineSound(this.listener)
  }

  dispose(): void {
    document.removeEventListener('pointerdown', this.unlockHandler)
    document.removeEventListener('keydown', this.keydownHandler)
  }
}
