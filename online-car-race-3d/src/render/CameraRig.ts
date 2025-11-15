import * as THREE from 'three'

export class CameraRig {
  private readonly camera: THREE.PerspectiveCamera
  private readonly target: THREE.Vector3
  private orbitRadius = 85
  private height = 60
  private azimuth = Math.PI / 4

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
    this.target = new THREE.Vector3(0, 0, 0)
    this.configureCamera()
  }

  setTarget(target: THREE.Vector3): void {
    this.target.copy(target)
  }

  update(_dt: number): void {
    // Placeholder for future dynamic behaviors (e.g., follow car)
    this.configureCamera()
  }

  private configureCamera(): void {
    const x = this.target.x + Math.cos(this.azimuth) * this.orbitRadius
    const z = this.target.z + Math.sin(this.azimuth) * this.orbitRadius
    this.camera.position.set(x, this.height, z)
    this.camera.lookAt(this.target)
  }
}
