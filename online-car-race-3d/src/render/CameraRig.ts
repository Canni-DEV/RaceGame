import * as THREE from 'three'

export class CameraRig {
  private readonly camera: THREE.PerspectiveCamera
  private readonly staticRotationOrder = 'YXZ'
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
  private followDistance = 10
  private followHeight = 12
  private followLookAhead = 12
  private maxFollowLagFraction = 0.1
  private lagCorrectionSpeed = 140
  private firstPersonHeight = 1.5
  private firstPersonForwardOffset = 7
  private firstPersonLookAhead = 30
  private followRotationLocked = false
  private readonly followForward = new THREE.Vector3(0, 0, 1)
  private readonly tempForward = new THREE.Vector3(0, 0, 1)
  private readonly tempOffset = new THREE.Vector3()
  private readonly tempLagTarget = new THREE.Vector3()
  private staticPose: { position: THREE.Vector3; rotation: THREE.Euler } | null = null

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

  getLookTarget(target: THREE.Vector3): THREE.Vector3 {
    return target.copy(this.lookTarget)
  }

  beginManualOrbit(): void {
    if (this.followTarget || this.staticPose) {
      return
    }
    this.manualOrbitActive = true
  }

  endManualOrbit(): void {
    this.manualOrbitActive = false
  }

  toggleAutoOrbit(): void {
    if (this.staticPose) {
      return
    }
    this.autoOrbitEnabled = !this.autoOrbitEnabled
  }

  adjustOrbit(deltaAzimuth: number, deltaAngle: number): void {
    if (this.followTarget || this.staticPose) {
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
    if (this.followTarget || this.staticPose) {
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
    this.minOrbitRadius = Math.max(this.baseOrbitRadius * 0.2, 10)
    this.maxOrbitRadius = this.baseOrbitRadius * 0.9
    const halfSpan = maxHorizontal * 0.2
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
    this.camera.far = distanceToTarget + boundsDiagonal * 10
    this.camera.updateProjectionMatrix()
    this.followDistance = Math.max(maxHorizontal * 0.02, 4)
    this.followHeight = Math.max(size.y, 8)
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

  setFollowLag(options: { maxFraction?: number; correctionSpeed?: number }): void {
    if (typeof options.maxFraction === 'number' && Number.isFinite(options.maxFraction)) {
      this.maxFollowLagFraction = THREE.MathUtils.clamp(options.maxFraction, 0, 1)
    }
    if (
      typeof options.correctionSpeed === 'number' &&
      Number.isFinite(options.correctionSpeed) &&
      options.correctionSpeed > 0
    ) {
      this.lagCorrectionSpeed = options.correctionSpeed
    }
  }

  isFollowing(): boolean {
    return this.followTarget !== null
  }

  isInputLocked(): boolean {
    return this.followTarget !== null || this.staticPose !== null
  }

  setStaticPose(pose: { position: THREE.Vector3; rotation: THREE.Euler } | null): void {
    this.staticPose = pose
    if (!pose) {
      return
    }
    this.currentPosition.copy(pose.position)
    this.desiredPosition.copy(pose.position)
    this.camera.position.copy(pose.position)
    this.applyStaticRotation(pose.rotation)
  }

  update(_dt: number): void {
    // Clamp delta to avoid frame-rate dependent damping; keep spikes bounded.
    const dt = THREE.MathUtils.clamp(_dt, 0, 0.05)
    if (this.staticPose) {
      this.currentPosition.copy(this.staticPose.position)
      this.desiredPosition.copy(this.staticPose.position)
      this.camera.position.copy(this.staticPose.position)
      this.applyStaticRotation(this.staticPose.rotation)
      return
    }
    const isFirstPerson = this.followMode === 'firstPerson'
    const targetLerpSpeed = isFirstPerson ? 6 : 3.5
    const targetLerp = 1 - Math.exp(-dt * targetLerpSpeed)

    if (this.followTarget) {
      const targetPosition = this.followTarget.position
      this.smoothedTarget.lerp(targetPosition, targetLerp)

      // Limit positional lag so distance stays stable even at high speed.
      this.tempOffset.subVectors(targetPosition, this.smoothedTarget)
      const lag = this.tempOffset.length()
      const maxLag = Math.max(this.followDistance * this.maxFollowLagFraction, 0.01)
      if (lag > maxLag) {
        // Move toward the capped target without snapping to preserve smooth transitions.
        const desiredTarget = this.tempLagTarget
          .copy(targetPosition)
          .addScaledVector(this.tempOffset, -maxLag / lag)
        const move = desiredTarget.sub(this.smoothedTarget)
        const moveDistance = move.length()
        if (moveDistance > 1e-6) {
          const maxStep = Math.max(this.followDistance * 10, this.lagCorrectionSpeed) * dt
          const stepFactor = Math.min(1, maxStep / moveDistance)
          this.smoothedTarget.addScaledVector(move, stepFactor)
        }
      }

      if (!this.followRotationLocked) {
        const targetForward = this.getTargetForward(this.followTarget)
        if (targetForward.lengthSq() > 1e-6) {
          const forwardLerpSpeed = isFirstPerson ? 10 : 6
          const forwardLerp = 1 - Math.exp(-dt * forwardLerpSpeed)
          this.followForward.lerp(targetForward, forwardLerp)
          this.followForward.normalize()
        }
      }
      this.desiredPosition.copy(this.smoothedTarget)
      if (isFirstPerson) {
        this.desiredPosition.addScaledVector(this.followForward, this.firstPersonForwardOffset)
        this.desiredPosition.y = this.smoothedTarget.y + this.firstPersonHeight
        this.lookTarget
          .copy(this.smoothedTarget)
          .addScaledVector(this.followForward, this.firstPersonLookAhead)
      } else {
        this.desiredPosition.addScaledVector(this.followForward, -this.followDistance)
        this.desiredPosition.y = this.smoothedTarget.y + this.followHeight
        this.lookTarget
          .copy(this.smoothedTarget)
          .addScaledVector(this.followForward, this.followLookAhead)
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

  private applyStaticRotation(rotation: THREE.Euler): void {
    const cameraRotation = this.camera.rotation as THREE.Euler & { order?: string }
    if (cameraRotation.order !== this.staticRotationOrder) {
      cameraRotation.order = this.staticRotationOrder
    }
    cameraRotation.set(rotation.x, rotation.y, rotation.z)
  }

  private getTargetForward(target: THREE.Object3D): THREE.Vector3 {
    this.tempForward.set(0, 0, 1)
    this.tempForward.applyQuaternion(target.quaternion)
    return this.tempForward.normalize()
  }
}
