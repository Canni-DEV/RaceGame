import * as THREE from 'three'

export interface EngineSoundConfig {
  idleRpm: number
  maxRpm: number
  maxSpeed: number
  minVolume: number
  maxVolume: number
  refDistance: number
  rolloff: number
  maxDistance: number
  /** Frecuencia base (Hz) cuando RPM = idleRpm */
  baseFreqIdle: number
  /** Frecuencia base (Hz) cuando RPM = maxRpm */
  baseFreqMax: number
  /** Frecuencia de corte del filtro pasa-bajos en ralentí */
  minFilterFrequency: number
  /** Frecuencia de corte del filtro pasa-bajos a RPM máximas */
  maxFilterFrequency: number
  /** Activar la capa de ruido en el sonido del motor */
  useNoise: boolean
  /** Peso de volumen de la capa de ruido (relativo a minVolume/maxVolume) */
  noiseVolumeWeight: number
  /** Activar modulación de frecuencia (vibración) con un LFO */
  useModulation: boolean
  /** Frecuencia del LFO (Hz) a RPM mínimas (ralentí) */
  minModFrequency: number
  /** Frecuencia del LFO (Hz) a RPM máximas */
  maxModFrequency: number
  /** Profundidad de modulación (amplitud en Hz) a RPM mínimas */
  modDepthIdle: number
  /** Profundidad de modulación (amplitud en Hz) a RPM máximas */
  modDepthMax: number
}

// Configuración por defecto con valores base.
// Se han agregado valores por defecto para nuevas opciones de ruido y modulación.
const DEFAULT_CONFIG: EngineSoundConfig = {
  idleRpm: 900,
  maxRpm: 8200,
  maxSpeed: 80,
  minVolume: 0.01,
  maxVolume: 0.20,
  refDistance: 5,
  rolloff: 1.6,
  maxDistance: 180,
  baseFreqIdle: 70,      // Frecuencia base (Hz) al ralentí
  baseFreqMax: 200,      // Frecuencia base (Hz) al RPM máximo
  minFilterFrequency: 900,   // Filtro bajo a ralentí (sonido más "muffler")
  maxFilterFrequency: 4800,  // Filtro más abierto a altas RPM (sonido más brillante)
  useNoise: true,
  noiseVolumeWeight: 0.4,    // Peso de volumen para la capa de ruido
  useModulation: true,
  minModFrequency: 20,       // Hz del LFO en ralentí (baja freq -> vibrato lento)
  maxModFrequency: 100,      // Hz del LFO en altas RPM (vibrato rápido/agudo)
  modDepthIdle: 20,          // Desviación de frecuencia (Hz) en ralentí por FM
  modDepthMax: 5,            // Desviación de freq (Hz) en altas RPM por FM (menor para suavizar)
}

type OscLayer = {
  osc: OscillatorNode
  gain: GainNode
  freqMultiplier: number
  detune: number
  volumeWeight: number
}

export class EngineSound {
  private readonly audio: THREE.PositionalAudio
  private readonly context: AudioContext
  private readonly layers: OscLayer[]
  private readonly mixGain: GainNode
  private readonly filter: BiquadFilterNode
  private readonly config: EngineSoundConfig
  private readonly onDispose?: () => void

  // Nuevos nodos para ruido y modulación
  private noiseSource?: AudioBufferSourceNode
  private noiseGain?: GainNode
  private lfoOsc?: OscillatorNode
  private lfoGain?: GainNode

  private rpm: number
  private targetRpm: number
  private started = false
  private disposed = false

  constructor(
    listener: THREE.AudioListener,
    config?: Partial<EngineSoundConfig>,
    onDispose?: () => void,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.onDispose = onDispose

    this.audio = new THREE.PositionalAudio(listener)
    this.audio.setRefDistance(this.config.refDistance)
    this.audio.setRolloffFactor(this.config.rolloff)
    this.audio.setDistanceModel('inverse')
    // Algunos bundles no incluyen typings para setMaxDistance; ajustamos el panner directamente.
    const panner = this.audio.getOutput() as PannerNode
    panner.maxDistance = this.config.maxDistance

    this.context = listener.context

    // Gain de mezcla de todas las capas antes del filtro
    this.mixGain = this.context.createGain()
    this.mixGain.gain.value = 1

    // Crear capas de osciladores base (armónicos fundamentales del motor)
    this.layers = [
      this.createLayer('triangle', 0.55, -6, 0.8),   // Capa 1: tono base más bajo (triangle suaviza armónicos)
      this.createLayer('sawtooth', 1, 0, 0.55),      // Capa 2: tono base principal (diente de sierra añade armónicos completos)
      this.createLayer('square', 1.9, 7, 0.3),       // Capa 3: armónico alto (square añade timbre brillante)
    ]

    // Crear filtro pasa-bajos para simular efecto de carga del motor (menos agudos a bajas RPM)
    this.filter = this.context.createBiquadFilter()
    this.filter.type = 'lowpass'
    // Fijamos frecuencia inicial del filtro según RPM de ralentí
    this.filter.frequency.value = this.config.minFilterFrequency

    // Conectar el generador procedural al flujo de audio 3D de Three.js
    // mixGain -> filtro pasa bajos -> PositionalAudio (panner del listener)
    const positionalAudio = this.audio as THREE.PositionalAudio & {
      setNodeSource: (node: AudioNode) => void
      setFilters: (filters: AudioNode[]) => void
    }

    positionalAudio.setNodeSource(this.mixGain)
    positionalAudio.setFilters([this.filter])

    // Preparar capa de ruido blanco (si está habilitada)
    if (this.config.useNoise) {
      this.noiseSource = this.context.createBufferSource()
      // Generar un buffer de ruido blanco de 1 segundo de duración
      const bufferSize = this.context.sampleRate
      const noiseBuffer = this.context.createBuffer(1, bufferSize, this.context.sampleRate)
      const output = noiseBuffer.getChannelData(0)
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1  // valores entre -1 y 1
      }
      this.noiseSource.buffer = noiseBuffer
      this.noiseSource.loop = true

      this.noiseGain = this.context.createGain()
      this.noiseGain.gain.value = 0  // iniciar silenciado, se ajustará según RPM

      // Conectar ruido -> gain -> mix
      this.noiseSource.connect(this.noiseGain)
      this.noiseGain.connect(this.mixGain)
    }

    // Preparar LFO para modulación de frecuencia (si está habilitado)
    if (this.config.useModulation) {
      this.lfoOsc = this.context.createOscillator()
      this.lfoOsc.type = 'sine'  // LFO seno para modulación suave
      // Frecuencia inicial del LFO según RPM inicial (ralentí)
      this.lfoOsc.frequency.value = this.config.minModFrequency

      this.lfoGain = this.context.createGain()
      // Profundidad inicial de modulación (amplitud del LFO) según ralentí
      this.lfoGain.gain.value = this.config.modDepthIdle

      // Conectar LFO -> Gain -> frecuencia del oscilador principal (por ejemplo, la capa sawtooth base)
      this.lfoOsc.connect(this.lfoGain)
      // Modula la frecuencia de la capa principal (layers[1] es la sawtooth base con freqMultiplier = 1)
      this.lfoGain.connect(this.layers[1].osc.frequency)
    }

    // Establecer RPM inicial (ralentí)
    this.rpm = this.config.idleRpm
    this.targetRpm = this.config.idleRpm
  }

  /** Adjunta el sonido posicional a un objeto 3D de Three.js (el vehículo) */
  attachTo(object: THREE.Object3D): void {
    object.add(this.audio)
  }

  /** Crea una capa de oscilador configurada con tipo de onda, frecuencia relativa, detune y peso de volumen. */
  private createLayer(
    type: OscillatorType,
    freqMultiplier: number,
    detune: number,
    volumeWeight: number,
  ): OscLayer {
    const osc = this.context.createOscillator()
    osc.type = type
    osc.detune.value = detune  // desafinación en centésimas (cents)

    const gain = this.context.createGain()
    gain.gain.value = 0  // inicia en silencio hasta que arranque el motor

    osc.connect(gain)
    gain.connect(this.mixGain)

    return { osc, gain, freqMultiplier, detune, volumeWeight }
  }

  /** Establece la velocidad objetivo (en unidades del juego) para actualizar las RPM objetivo del motor. */
  setTargetSpeed(speed: number): void {
    const clampedSpeed = THREE.MathUtils.clamp(Math.abs(speed), 0, this.config.maxSpeed)
    // Mapear la velocidad a RPM usando idleRpm en 0 y maxRpm en maxSpeed
    const rpm = THREE.MathUtils.mapLinear(
      clampedSpeed,
      0,
      this.config.maxSpeed,
      this.config.idleRpm,
      this.config.maxRpm,
    )
    // Asegurar que nunca baje de idleRpm ni exceda maxRpm
    this.targetRpm = THREE.MathUtils.clamp(rpm, this.config.idleRpm, this.config.maxRpm)
  }

  /** Actualiza el sonido del motor en cada frame, ajustando tonos y volúmenes según dt y posición (opcional). */
  update(dt: number, position?: THREE.Vector3): void {
    // Interpolar suavemente las RPM actuales hacia las RPM objetivo (filtro de suavizado exponencial)
    const smoothing = 1 - Math.exp(-dt * 6)
    this.rpm = THREE.MathUtils.lerp(this.rpm, this.targetRpm, smoothing)

    // Normalizar RPM en [0,1] relativo al rango [idleRpm, maxRpm]
    const normalized = THREE.MathUtils.clamp(
      (this.rpm - this.config.idleRpm) / (this.config.maxRpm - this.config.idleRpm),
      0,
      1,
    )

    // Calcular frecuencia base actual interpolando entre baseFreqIdle y baseFreqMax según RPM
    const baseFrequency = THREE.MathUtils.lerp(this.config.baseFreqIdle, this.config.baseFreqMax, normalized)
    // Calcular frecuencia de corte del filtro según RPM (más alta a mayor RPM para más brillo)
    const filterFrequency = THREE.MathUtils.lerp(this.config.minFilterFrequency, this.config.maxFilterFrequency, normalized)
    // Calcular volumen general según RPM (interpolación lineal entre minVolume y maxVolume)
    const volume = THREE.MathUtils.lerp(this.config.minVolume, this.config.maxVolume, normalized)

    // Actualizar cada capa de oscilador audible
    for (const layer of this.layers) {
      // Frecuencia objetivo de este oscilador = frecuencia base * factor de esta capa
      const layerFreq = baseFrequency * layer.freqMultiplier
      // Volumen objetivo de esta capa = volumen global * peso de capa * factor extra dependiente de RPM.
      // (El factor 0.7 + 0.6*normalized hace que a altas RPM cada capa gane ~30% más volumen relativo)
      const targetVolume = volume * layer.volumeWeight * (0.7 + 0.6 * normalized)
      // Aplicar cambios suavizados usando setTargetAtTime para evitar clics abruptos
      layer.osc.frequency.setTargetAtTime(layerFreq, this.context.currentTime, 0.08)
      layer.gain.gain.setTargetAtTime(targetVolume, this.context.currentTime, 0.1)
    }

    // Actualizar la capa de ruido (si existe)
    if (this.config.useNoise && this.noiseGain) {
      // Similar a las capas: volumen del ruido según volumen global * peso * factor dependiente de RPM
      const targetNoiseVolume = volume * this.config.noiseVolumeWeight * (0.7 + 0.6 * normalized)
      this.noiseGain.gain.setTargetAtTime(targetNoiseVolume, this.context.currentTime, 0.1)
      // (La frecuencia del ruido es todo el espectro, pero el filtro global lo modelará)
    }

    // Actualizar parámetros del LFO de modulación (si existe)
    if (this.config.useModulation && this.lfoOsc && this.lfoGain) {
      // Calcular frecuencia objetivo del LFO (interpolar entre minModFrequency y maxModFrequency)
      const targetLfoFreq = THREE.MathUtils.lerp(this.config.minModFrequency, this.config.maxModFrequency, normalized)
      // Calcular profundidad (ganancia) de modulación objetivo (interpolar entre modDepthIdle y modDepthMax)
      const targetLfoDepth = THREE.MathUtils.lerp(this.config.modDepthIdle, this.config.modDepthMax, normalized)
      // Actualizar LFO suavemente
      this.lfoOsc.frequency.setTargetAtTime(targetLfoFreq, this.context.currentTime, 0.08)
      this.lfoGain.gain.setTargetAtTime(targetLfoDepth, this.context.currentTime, 0.1)
    }

    // Actualizar la frecuencia de corte del filtro suavemente
    this.filter.frequency.setTargetAtTime(filterFrequency, this.context.currentTime, 0.12)

    // Si se proporciona posición, sincronizarla sin romper la relación padre-hijo.
    // Cuando el audio es hijo de un vehículo, lo anclamos al origen local para
    // que siga la malla; si no tiene padre, usamos la posición absoluta.
    if (position) {
      if (this.audio.parent) {
        this.audio.position.set(0, 0, 0)
      } else {
        this.audio.position.copy(position)
      }
    } else if (this.audio.parent) {
      this.audio.position.set(0, 0, 0)
    }
  }

  /** Inicia la generación del sonido del motor (debe llamarse tras una interacción del usuario debido a políticas de auto-play en navegadores). */
  start(): void {
    if (this.started || this.disposed) {
      return
    }
    // Iniciar los osciladores de cada capa
    for (const layer of this.layers) {
      layer.osc.start()
    }
    // Iniciar ruido si está habilitado
    if (this.config.useNoise && this.noiseSource) {
      this.noiseSource.start()
    }
    // Iniciar LFO si está habilitado
    if (this.config.useModulation && this.lfoOsc) {
      this.lfoOsc.start()
    }
    // Log para depurar activación de audio (útil para confirmar que se habilitó tras gesto de usuario)
    if (typeof console !== 'undefined') {
      console.info('[Audio] Engine oscillator started')
    }
    this.started = true
  }

  /** Indica si el sonido ya fue liberado (disposed). */
  isDisposed(): boolean {
    return this.disposed
  }

  /** Detiene y libera todos los recursos de audio. Debe llamarse al eliminar el vehículo para evitar fugas de audio. */
  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true

    // Detener osciladores si estaban en marcha
    if (this.started) {
      for (const layer of this.layers) {
        layer.osc.stop()
      }
      if (this.config.useNoise && this.noiseSource) {
        this.noiseSource.stop()
      }
      if (this.config.useModulation && this.lfoOsc) {
        this.lfoOsc.stop()
      }
    }

    // Desconectar y limpiar cada nodo
    for (const layer of this.layers) {
      layer.osc.disconnect()
      layer.gain.disconnect()
    }
    if (this.config.useNoise && this.noiseSource && this.noiseGain) {
      this.noiseSource.disconnect()
      this.noiseGain.disconnect()
    }
    if (this.config.useModulation && this.lfoOsc && this.lfoGain) {
      this.lfoOsc.disconnect()
      this.lfoGain.disconnect()
    }
    this.filter.disconnect()
    this.mixGain.disconnect()
    this.audio.removeFromParent()
    this.onDispose?.()
  }
}
