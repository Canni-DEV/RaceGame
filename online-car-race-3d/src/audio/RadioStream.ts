import * as THREE from 'three'

export type RadioStreamConfig = {
  volume: number
  refDistance: number
  rolloff: number
  maxDistance: number
}

export class RadioStream {
  private readonly audio: THREE.PositionalAudio
  private readonly audioElement: HTMLAudioElement
  private readonly sourceNode: MediaElementAudioSourceNode
  private currentUrl: string | null = null
  private shouldPlay = false

  constructor(listener: THREE.AudioListener, config: RadioStreamConfig) {
    this.audio = new THREE.PositionalAudio(listener)
    this.audio.setRefDistance(config.refDistance)
    this.audio.setRolloffFactor(config.rolloff)
    this.audio.setDistanceModel('inverse')
    this.audio.setVolume(config.volume)
    const panner = this.audio.getOutput() as PannerNode
    panner.maxDistance = config.maxDistance

    this.audioElement = new Audio()
    this.audioElement.crossOrigin = 'anonymous'
    this.audioElement.preload = 'none'
    this.audioElement.setAttribute('playsinline', 'true')
    this.audioElement.setAttribute('webkit-playsinline', 'true')

    this.sourceNode = listener.context.createMediaElementSource(this.audioElement)

    const positional = this.audio as THREE.PositionalAudio & {
      setNodeSource: (node: AudioNode) => void
    }
    positional.setNodeSource(this.sourceNode)
  }

  attachTo(target: THREE.Object3D): void {
    if (this.audio.parent && this.audio.parent !== target) {
      this.audio.removeFromParent()
    }
    if (!this.audio.parent) {
      target.add(this.audio)
      this.audio.position.set(0, 0, 0)
    }
  }

  setTarget(url: string | null, shouldPlay: boolean): void {
    this.currentUrl = url
    this.shouldPlay = shouldPlay
    this.syncPlayback()
  }

  private syncPlayback(): void {
    if (!this.shouldPlay || !this.currentUrl) {
      this.stopPlayback()
      return
    }

    if (this.audioElement.src !== this.currentUrl) {
      this.audioElement.src = this.currentUrl
      this.audioElement.load()
    }

    if (this.audioElement.paused) {
      void this.audioElement.play().catch(() => {
        // Ignorar errores de autoplay: se reintentará cuando el usuario habilite audio.
      })
    }
  }

  private stopPlayback(): void {
    if (!this.audioElement.paused) {
      this.audioElement.pause()
    }
    if (this.audioElement.src) {
      this.audioElement.removeAttribute('src')
      this.audioElement.load()
    }
  }
}
