import * as THREE from 'three'

export class CameraRig {
  private readonly camera: THREE.PerspectiveCamera
  private readonly manualTarget: THREE.Vector3
  private readonly smoothedTarget: THREE.Vector3
  private readonly desiredPosition: THREE.Vector3
  private readonly currentPosition: THREE.Vector3
  private baseOrbitRadius = 85
  private baseHeight = 60
  private minOrbitRadius = 40
  private maxOrbitRadius = 200
  private minClearance = 8
  private orbitSpeed = 0.15
  private verticalAngle = Math.atan2(this.baseHeight, this.baseOrbitRadius)
  private maxVerticalAngle = Math.PI * 0.38
  private zoomFactor = 1
  private minZoom = 0.5
  private maxZoom = 1.5
  private groundLevel = 0
  private azimuth = Math.PI / 4
  private autoOrbitEnabled = false
  private manualOrbitActive = false
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

  beginManualOrbit(): void {
    if (this.followTarget) {
      return
    }
    this.manualOrbitActive = true
  }

  endManualOrbit(): void {
    this.manualOrbitActive = false
  }

  toggleAutoOrbit(): void {
    this.autoOrbitEnabled = !this.autoOrbitEnabled
  }

  adjustOrbit(deltaAzimuth: number, deltaAngle: number): void {
    if (this.followTarget) {
      return
    }
    this.azimuth = this.wrapAngle(this.azimuth + deltaAzimuth)

    const radius = this.getCurrentRadius()
    const minAngle = this.getMinVerticalAngle(radius)
    this.verticalAngle = THREE.MathUtils.clamp(
      this.verticalAngle + deltaAngle,
      minAngle,
      this.maxVerticalAngle,
    )
  }

  adjustZoom(delta: number): void {
    if (this.followTarget) {
      return
    }
    this.zoomFactor = THREE.MathUtils.clamp(
      this.zoomFactor * delta,
      this.minZoom,
      this.maxZoom,
    )
  }

  frameBounds(bounds: THREE.Box3): void {
    const size = bounds.getSize(new THREE.Vector3())
    const maxHorizontal = Math.max(size.x, size.z)
    this.baseOrbitRadius = Math.max(maxHorizontal * 0.5, 60)
    this.minOrbitRadius = Math.max(this.baseOrbitRadius * 0.55, 35)
    this.maxOrbitRadius = this.baseOrbitRadius * 2.5
    const halfSpan = maxHorizontal * 0.6
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov * 0.5)
    const neededHeight = halfSpan / Math.tan(halfFov)
    const verticalPadding = Math.max(size.y * 0.5, 40)
    this.baseHeight = Math.max(neededHeight + verticalPadding, 200)
    this.zoomFactor = 1
    this.verticalAngle = Math.atan2(this.baseHeight, this.baseOrbitRadius)
    this.groundLevel = bounds.min.y
    const distanceToTarget = Math.hypot(this.baseHeight, this.baseOrbitRadius)
    const boundsDiagonal = size.length()
    const farPadding = Math.max(boundsDiagonal * 1.5, distanceToTarget * 40, 3000)
    this.camera.near = Math.max(0.5, distanceToTarget * 0.01)
    this.camera.far = distanceToTarget + farPadding
    this.camera.updateProjectionMatrix()
    this.followDistance = Math.max(maxHorizontal * 0.05, 24)
    this.followHeight = Math.max(size.y + 10, 10)
    this.setTarget(bounds.getCenter(new THREE.Vector3()))
    const radius = this.getCurrentRadius()
    const minAngle = this.getMinVerticalAngle(radius)
    this.verticalAngle = THREE.MathUtils.clamp(
      this.verticalAngle,
      minAngle,
      this.maxVerticalAngle,
    )
    this.smoothedTarget.copy(this.manualTarget)
  }

  follow(object: THREE.Object3D | null): void {
    this.followTarget = object
  }

  isFollowing(): boolean {
    return this.followTarget !== null
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
      if (!this.manualOrbitActive && this.autoOrbitEnabled) {
        this.azimuth = this.wrapAngle(this.azimuth + dt * this.orbitSpeed)
      }
      const radius = this.getCurrentRadius()
      const minAngle = this.getMinVerticalAngle(radius)
      this.verticalAngle = THREE.MathUtils.clamp(
        this.verticalAngle,
        minAngle,
        this.maxVerticalAngle,
      )
      const height = Math.tan(this.verticalAngle) * radius
      this.desiredPosition.set(
        this.smoothedTarget.x + Math.cos(this.azimuth) * radius,
        this.smoothedTarget.y + height,
        this.smoothedTarget.z + Math.sin(this.azimuth) * radius,
      )
    }

    const positionLerp = 1 - Math.exp(-dt * 4.5)
    this.currentPosition.lerp(this.desiredPosition, positionLerp)
    this.camera.position.copy(this.currentPosition)
    this.camera.lookAt(this.smoothedTarget)
  }

  private configureCamera(): void {
    const radius = this.getCurrentRadius()
    const height = Math.tan(this.verticalAngle) * radius
    this.currentPosition.set(
      this.manualTarget.x + Math.cos(this.azimuth) * radius,
      this.manualTarget.y + height,
      this.manualTarget.z + Math.sin(this.azimuth) * radius,
    )
    this.camera.position.copy(this.currentPosition)
    this.camera.lookAt(this.manualTarget)
  }

  private getCurrentRadius(): number {
    const radius = this.baseOrbitRadius * this.zoomFactor
    return THREE.MathUtils.clamp(radius, this.minOrbitRadius, this.maxOrbitRadius)
  }

  private getMinVerticalAngle(radius: number): number {
    const relativeMinHeight = Math.max(this.groundLevel + this.minClearance - this.smoothedTarget.y, 0)
    return Math.atan2(relativeMinHeight, radius)
  }

  private wrapAngle(value: number): number {
    const fullTurn = Math.PI * 2
    return ((value % fullTurn) + fullTurn) % fullTurn
  }
}
