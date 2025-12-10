import * as THREE from 'three'

export class CameraRig {
  private readonly camera: THREE.PerspectiveCamera
  private readonly manualTarget: THREE.Vector3
  private readonly smoothedTarget: THREE.Vector3
  private readonly desiredPosition: THREE.Vector3
  private readonly currentPosition: THREE.Vector3
  private readonly lookTarget: THREE.Vector3
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
  private followMode: 'chase' | 'firstPerson' = 'chase'
  private followDistance = 26
  private followHeight = 14
  private firstPersonHeight = 1.5
  private firstPersonForwardOffset = 6
  private firstPersonLookAhead = 30
  private followRotationLocked = false
  private readonly followForward = new THREE.Vector3(0, 0, 1)
  private readonly tempForward = new THREE.Vector3(0, 0, 1)

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera
    this.manualTarget = new THREE.Vector3(0, 0, 0)
    this.smoothedTarget = new THREE.Vector3(0, 0, 0)
    this.desiredPosition = new THREE.Vector3()
    this.currentPosition = new THREE.Vector3()
    this.lookTarget = new THREE.Vector3()
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
    this.camera.near = Math.max(0.1, distanceToTarget * 0.001)
    this.camera.far = distanceToTarget + boundsDiagonal * 0.75
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

  follow(
    object: THREE.Object3D | null,
    options?: { lockRotation?: boolean; mode?: 'chase' | 'firstPerson' },
  ): void {
    if (object !== this.followTarget && object) {
      this.followForward.copy(this.getTargetForward(object))
    }
    this.followTarget = object
    this.followMode = options?.mode ?? 'chase'
    this.followRotationLocked = object ? Boolean(options?.lockRotation) : false
    if (!object) {
      this.followMode = 'chase'
    }
  }

  isFollowing(): boolean {
    return this.followTarget !== null
  }

  update(_dt: number): void {
    const dt = Math.max(_dt, 0.016)
    const targetLerpSpeed = this.followMode === 'firstPerson' ? 6 : 3.5
    const targetLerp = 1 - Math.exp(-dt * targetLerpSpeed)
    this.lookTarget.copy(this.smoothedTarget)

    if (this.followTarget) {
      this.smoothedTarget.lerp(this.followTarget.position, targetLerp)
      if (!this.followRotationLocked) {
        const targetForward = this.getTargetForward(this.followTarget)
        if (targetForward.lengthSq() > 1e-6) {
          const forwardLerpSpeed = this.followMode === 'firstPerson' ? 10 : 6
          const forwardLerp = 1 - Math.exp(-dt * forwardLerpSpeed)
          this.followForward.lerp(targetForward, forwardLerp)
          this.followForward.normalize()
        }
      }
      this.desiredPosition.copy(this.smoothedTarget)
      if (this.followMode === 'firstPerson') {
        this.desiredPosition.addScaledVector(this.followForward, this.firstPersonForwardOffset)
        this.desiredPosition.y = this.smoothedTarget.y + this.firstPersonHeight
        this.lookTarget
          .copy(this.smoothedTarget)
          .addScaledVector(this.followForward, this.firstPersonLookAhead)
      } else {
        this.desiredPosition.addScaledVector(this.followForward, -this.followDistance)
        this.desiredPosition.y = this.smoothedTarget.y + this.followHeight
        this.lookTarget.copy(this.smoothedTarget)
      }
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
      this.lookTarget.copy(this.smoothedTarget)
    }

    const positionLerp = 1 - Math.exp(-dt * 4.5)
    this.currentPosition.lerp(this.desiredPosition, positionLerp)
    this.camera.position.copy(this.currentPosition)
    this.camera.lookAt(this.lookTarget)
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

  private getTargetForward(target: THREE.Object3D): THREE.Vector3 {
    this.tempForward.set(0, 0, 1)
    this.tempForward.applyQuaternion(target.quaternion)
    return this.tempForward.normalize()
  }
}
