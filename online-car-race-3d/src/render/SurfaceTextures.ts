import * as THREE from 'three'

type NoiseTextureOptions = {
  size: number
  baseColor: THREE.Color
  variance: number
  fiberLines: number
  fiberOpacity: number
}

const clampChannel = (value: number): number => {
  return Math.max(0, Math.min(255, Math.round(value)))
}

const createNoiseTexture = (options: NoiseTextureOptions): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas')
  canvas.width = options.size
  canvas.height = options.size
  const context = canvas.getContext('2d')
  if (!context) {
    return new THREE.CanvasTexture(canvas)
  }

  const image = context.getImageData(0, 0, options.size, options.size)
  const data = image.data
  const base = options.baseColor
  const baseR = base.r * 255
  const baseG = base.g * 255
  const baseB = base.b * 255
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() * 2 - 1) * options.variance
    data[i] = clampChannel(baseR + noise)
    data[i + 1] = clampChannel(baseG + noise)
    data[i + 2] = clampChannel(baseB + noise)
    data[i + 3] = 255
  }
  context.putImageData(image, 0, 0)

  if (options.fiberLines > 0) {
    context.strokeStyle = `rgba(255, 255, 255, ${options.fiberOpacity})`
    context.lineWidth = 1
    for (let i = 0; i < options.fiberLines; i++) {
      const y = Math.random() * options.size
      const x = Math.random() * options.size
      const length = options.size * (0.3 + Math.random() * 0.6)
      context.beginPath()
      context.moveTo(x, y)
      context.lineTo(x + length, y + (Math.random() * 6 - 3))
      context.stroke()
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

let feltTexture: THREE.CanvasTexture | null = null
let asphaltTexture: THREE.CanvasTexture | null = null

export const getFeltTexture = (): THREE.CanvasTexture => {
  if (!feltTexture) {
    feltTexture = createNoiseTexture({
      size: 256,
      baseColor: new THREE.Color(0x2f5a3b),
      variance: 34,
      fiberLines: 160,
      fiberOpacity: 0.07,
    })
  }
  return feltTexture
}

export const getAsphaltTexture = (): THREE.CanvasTexture => {
  if (!asphaltTexture) {
    asphaltTexture = createNoiseTexture({
      size: 256,
      baseColor: new THREE.Color(0x2c2c34),
      variance: 20,
      fiberLines: 36,
      fiberOpacity: 0.025,
    })
  }
  return asphaltTexture
}
