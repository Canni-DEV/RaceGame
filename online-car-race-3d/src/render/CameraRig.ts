import * as THREE from 'three'

export class CameraRig {
  private readonly camera: THREE.PerspectiveCamera
  private readonly manualTarget: THREE.Vector3
  private readonly smoothedTarget: THREE.Vector3
  private readonly desiredPosition: THREE.Vector3
  private readonly currentPosition: THREE.Vector3
  private orbitRadius = 85
  private height = 60
  private azimuth = Math.PI / 4
  private followTarget: THREE.Object3D | null = null
  private followDistance = 26
  private followHeight = 14

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
    this.manualTarget = new THREE.Vector3(0, 0, 0)
    this.smoothedTarget = new THREE.Vector3(0, 0, 0)
    this.desiredPosition = new THREE.Vector3()
    this.currentPosition = new THREE.Vector3()
    this.configureCamera()
    this.smoothedTarget.copy(this.manualTarget)
  }

  setTarget(target: THREE.Vector3): void {
    this.manualTarget.copy(target)
  }

  frameBounds(bounds: THREE.Box3): void {
    const size = bounds.getSize(new THREE.Vector3())
    const maxHorizontal = Math.max(size.x, size.z)
    this.orbitRadius = Math.max(maxHorizontal * 0.75, 60)
    this.height = Math.max(size.y + 35, 40)
    this.followDistance = Math.max(maxHorizontal * 0.2, 24)
    this.followHeight = Math.max(size.y + 10, 12)
    this.setTarget(bounds.getCenter(new THREE.Vector3()))
  }

  follow(object: THREE.Object3D | null): void {
    this.followTarget = object
  }

  update(_dt: number): void {
    const dt = Math.max(_dt, 0.016)
    const targetLerp = 1 - Math.exp(-dt * 3.5)
    if (this.followTarget) {
      this.smoothedTarget.lerp(this.followTarget.position, targetLerp)
      const forward = new THREE.Vector3(0, 0, 1)
      forward.applyQuaternion(this.followTarget.quaternion)
      forward.normalize()
      this.desiredPosition.copy(this.smoothedTarget)
      this.desiredPosition.addScaledVector(forward, -this.followDistance)
      this.desiredPosition.y = this.smoothedTarget.y + this.followHeight
    } else {
      this.smoothedTarget.lerp(this.manualTarget, targetLerp)
      this.desiredPosition.set(
        this.smoothedTarget.x + Math.cos(this.azimuth) * this.orbitRadius,
        this.smoothedTarget.y + this.height,
        this.smoothedTarget.z + Math.sin(this.azimuth) * this.orbitRadius,
      )
    }

    const positionLerp = 1 - Math.exp(-dt * 4.5)
    this.currentPosition.lerp(this.desiredPosition, positionLerp)
    this.camera.position.copy(this.currentPosition)
    this.camera.lookAt(this.smoothedTarget)
  }

  private configureCamera(): void {
    this.currentPosition.set(
      this.manualTarget.x + Math.cos(this.azimuth) * this.orbitRadius,
      this.manualTarget.y + this.height,
      this.manualTarget.z + Math.sin(this.azimuth) * this.orbitRadius,
    )
    this.camera.position.copy(this.currentPosition)
    this.camera.lookAt(this.manualTarget)
  }
}
