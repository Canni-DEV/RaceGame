import * as THREE from 'three'
import { EngineSound } from './EngineSound'

export class AudioManager {
  private readonly listener: THREE.AudioListener
  private readonly unlockHandler: () => void
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
      })
    }

    document.addEventListener('pointerdown', this.unlockHandler, { passive: true })
    document.addEventListener('keydown', this.unlockHandler, { passive: true })
  }

  createEngineSound(): EngineSound {
    // Ensure the context is resumed as soon as possible; browsers still require
    // a user gesture, so we rely on the unlock handler to do the heavy lifting.
    void this.listener.context.resume()
    return new EngineSound(this.listener)
  }

  dispose(): void {
    document.removeEventListener('pointerdown', this.unlockHandler)
    document.removeEventListener('keydown', this.unlockHandler)
  }
}
