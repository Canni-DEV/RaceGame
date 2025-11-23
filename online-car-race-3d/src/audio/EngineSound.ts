import * as THREE from 'three'

export interface EngineSoundConfig {
  idleRpm: number
  maxRpm: number
  maxSpeed: number
  minVolume: number
  maxVolume: number
}

const DEFAULT_CONFIG: EngineSoundConfig = {
  idleRpm: 900,
  maxRpm: 8200,
  maxSpeed: 75,
  minVolume: 0.04,
  maxVolume: 0.22,
}

export class EngineSound {
  private readonly audio: THREE.PositionalAudio
  private readonly context: AudioContext
  private readonly oscillator: OscillatorNode
  private readonly gainNode: GainNode
  private readonly filter: BiquadFilterNode
  private readonly config: EngineSoundConfig
  private rpm: number
  private targetRpm: number

  constructor(listener: THREE.AudioListener, config?: Partial<EngineSoundConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }

    this.audio = new THREE.PositionalAudio(listener)
    this.audio.setRefDistance(6)
    this.audio.setRolloffFactor(2.2)
    this.audio.setDistanceModel('exponential')

    this.context = listener.context

    this.oscillator = this.context.createOscillator()
    this.oscillator.type = 'sawtooth'

    this.gainNode = this.context.createGain()
    this.gainNode.gain.value = 0

    this.filter = this.context.createBiquadFilter()
    this.filter.type = 'lowpass'
    this.filter.frequency.value = 1200

    this.oscillator.connect(this.gainNode)
    this.gainNode.connect(this.filter)
    this.filter.connect(this.audio.getOutput())

    this.rpm = this.config.idleRpm
    this.targetRpm = this.config.idleRpm

    this.oscillator.start()
  }

  attachTo(object: THREE.Object3D): void {
    object.add(this.audio)
  }

  setTargetSpeed(speed: number): void {
    const clampedSpeed = THREE.MathUtils.clamp(Math.abs(speed), 0, this.config.maxSpeed)
    const rpm = THREE.MathUtils.mapLinear(
      clampedSpeed,
      0,
      this.config.maxSpeed,
      this.config.idleRpm,
      this.config.maxRpm,
    )
    this.targetRpm = THREE.MathUtils.clamp(rpm, this.config.idleRpm, this.config.maxRpm)
  }

  update(dt: number, position?: THREE.Vector3): void {
    const smoothing = 1 - Math.exp(-dt * 6)
    this.rpm = THREE.MathUtils.lerp(this.rpm, this.targetRpm, smoothing)

    const normalized = THREE.MathUtils.clamp(
      (this.rpm - this.config.idleRpm) / (this.config.maxRpm - this.config.idleRpm),
      0,
      1,
    )

    const baseFrequency = THREE.MathUtils.lerp(60, 290, normalized)
    const filterFrequency = THREE.MathUtils.lerp(450, 4200, normalized)
    const volume = THREE.MathUtils.lerp(this.config.minVolume, this.config.maxVolume, normalized)

    this.oscillator.frequency.setTargetAtTime(baseFrequency, this.context.currentTime, 0.08)
    this.filter.frequency.setTargetAtTime(filterFrequency, this.context.currentTime, 0.12)
    this.gainNode.gain.setTargetAtTime(volume, this.context.currentTime, 0.1)

    if (position) {
      this.audio.position.copy(position)
    }
  }

  dispose(): void {
    this.oscillator.stop()
    this.oscillator.disconnect()
    this.gainNode.disconnect()
    this.filter.disconnect()
    this.audio.removeFromParent()
  }
}
