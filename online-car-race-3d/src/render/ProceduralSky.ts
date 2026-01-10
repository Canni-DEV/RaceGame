import * as THREE from 'three'

export interface ProceduralSkyOptions {
  radius?: number
  topColor?: THREE.ColorRepresentation
  middleColor?: THREE.ColorRepresentation
  bottomColor?: THREE.ColorRepresentation
  timeOfDay?: number
}

export class ProceduralSky {
  readonly mesh: THREE.Mesh
  private readonly material: THREE.MeshBasicMaterial
  private readonly topColor: THREE.Color
  private readonly middleColor: THREE.Color
  private readonly bottomColor: THREE.Color
  private timeOfDay: number

  constructor(options: ProceduralSkyOptions = {}) {
    const {
      radius = 15000,
      topColor = '#6fa8ff',
      middleColor = '#9cd0ff',
      bottomColor = '#f7efe5',
      timeOfDay = 0.2,
    } = options

    this.topColor = new THREE.Color(topColor)
    this.middleColor = new THREE.Color(middleColor)
    this.bottomColor = new THREE.Color(bottomColor)
    this.timeOfDay = THREE.MathUtils.clamp(timeOfDay, 0, 1)

    const geometry = new THREE.SphereGeometry(radius, 16, 12)
    const gradientTexture = this.createGradientTexture(this.timeOfDay)

    this.material = new THREE.MeshBasicMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      map: gradientTexture,
      toneMapped: false,
    })

    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.name = 'procedural-sky'
    this.mesh.frustumCulled = false
  }

  update(_deltaTime: number, cameraPosition?: THREE.Vector3): void {
    if (cameraPosition) {
      this.mesh.position.copy(cameraPosition)
    }
  }

  setTimeOfDay(value: number): void {
    const clamped = THREE.MathUtils.clamp(value, 0, 1)
    if (clamped === this.timeOfDay) {
      return
    }
    this.timeOfDay = clamped
    this.updateGradient()
  }

  private createGradientTexture(time: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) {
      return new THREE.CanvasTexture(canvas)
    }

    const { top, middle, bottom } = this.computeTintedColors(time)
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
    gradient.addColorStop(0, `#${top.getHexString()}`)
    gradient.addColorStop(0.45, `#${middle.getHexString()}`)
    gradient.addColorStop(1, `#${bottom.getHexString()}`)
    context.fillStyle = gradient
    context.fillRect(0, 0, canvas.width, canvas.height)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    texture.needsUpdate = true
    return texture
  }

  private computeTintedColors(time: number): {
    top: THREE.Color
    middle: THREE.Color
    bottom: THREE.Color
  } {
    const warmTint = new THREE.Color(1.08, 0.72, 0.48)
    const coolTint = new THREE.Color(0.92, 0.98, 1.05)

    const horizonInfluence = THREE.MathUtils.lerp(0.1, 0.85, time)
    const top = this.topColor.clone().lerp(coolTint, 0.3)
    const middle = this.middleColor.clone().lerp(warmTint, horizonInfluence * 0.35)
    const bottom = this.bottomColor
      .clone()
      .lerp(warmTint, horizonInfluence)

    return { top, middle, bottom }
  }

  private updateGradient(): void {
    const updatedTexture = this.createGradientTexture(this.timeOfDay)
    this.material.map?.dispose()
    this.material.map = updatedTexture
    this.material.needsUpdate = true
  }
}
