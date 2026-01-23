import * as THREE from 'three'
import type { CarState } from '../core/trackTypes'
import { CarModelLoader } from './CarModelLoader'
import { TRACK_SURFACE_HEIGHT } from './TrackMeshBuilder'
import type { AudioManager } from '../audio/AudioManager'
import type { EngineSound } from '../audio/EngineSound'

const TEMP_VECTOR = new THREE.Vector3()
const ANGLE_FORWARD = new THREE.Vector3()
const MAX_SPEED_FOR_ALIGNMENT = 45
const PITCH_AXIS = new THREE.Vector3(1, 0, 0)
const TURBO_LIFT_SETTINGS = {
  liftAngle: THREE.MathUtils.degToRad(9),
  speedThreshold: 22,
  raiseSpeed: THREE.MathUtils.degToRad(90),
  lowerSpeed: THREE.MathUtils.degToRad(55),
  pivotOffset: new THREE.Vector3(0, -0.3, -1.35),
}
const TURBO_PIVOT_HAS_OFFSET = TURBO_LIFT_SETTINGS.pivotOffset.lengthSq() > 0
const TURBO_LIFT_PIVOT_WORLD = new THREE.Vector3()
const TURBO_LIFT_PIVOT_WORLD_AFTER = new THREE.Vector3()
const TEMP_EULER = new THREE.Euler()

export class CarEntity {
  readonly id: string
  private readonly scene: THREE.Scene
  private readonly loader: CarModelLoader
  private readonly color: THREE.Color
  private showNameLabel: boolean
  private username: string
  private object: THREE.Object3D | null = null
  private readonly engineSound: EngineSound | null
  private readonly currentPosition = new THREE.Vector3(0, TRACK_SURFACE_HEIGHT, 0)
  private readonly targetPosition = new THREE.Vector3(0, TRACK_SURFACE_HEIGHT, 0)
  private readonly orientation: THREE.Quaternion = new THREE.Quaternion()
  private readonly targetOrientation: THREE.Quaternion = new THREE.Quaternion()
  private readonly desiredForward = new THREE.Vector3(0, 0, 1)
  private readonly lastServerPosition = new THREE.Vector3(0, TRACK_SURFACE_HEIGHT, 0)
  private readonly pitchQuaternion: THREE.Quaternion = new THREE.Quaternion()
  private readonly composedOrientation: THREE.Quaternion = new THREE.Quaternion()
  private hasReceivedState = false
  private disposed = false
  private impactSpinTimeLeft = 0
  private currentTurboPitch = 0
  private targetTurboPitch = 0
  private nameSprite: THREE.Sprite | null = null
  private nameTexture: THREE.CanvasTexture | null = null
  private nameLabelAspect = 1
  private readonly baseNameHeight = 1
  private readonly minNameScale = 0.4
  private readonly maxNameScale = 2
  private readonly distanceScaleFactor = 0.015
  private currentNameScale = 1
  private isVisible = true

  constructor(
    id: string,
    username: string,
    scene: THREE.Scene,
    loader: CarModelLoader,
    color: THREE.Color,
    audioManager: AudioManager | null,
    showNameLabel = true,
  ) {
    this.id = id
    this.username = username
    this.scene = scene
    this.loader = loader
    this.color = color
    this.showNameLabel = showNameLabel
    this.engineSound = audioManager ? audioManager.createEngineSound() : null
    void this.spawn()
  }

  private async spawn(): Promise<void> {
    if (this.disposed) {
      return
    }
    const object = await this.loader.createInstance(this.color)
    if (this.disposed) {
      // Recursos compartidos a través del loader; no se eliminan aquí.
      return
    }
    object.position.copy(this.currentPosition)
    object.quaternion.copy(this.orientation)
    object.visible = this.isVisible
    this.scene.add(object)
    this.object = object

    this.updateNameLabel()

    if (this.engineSound) {
      this.engineSound.attachTo(object)
    }
  }

  setTargetState(state: CarState): void {
    if (state.username && state.username !== this.username) {
      this.setUsername(state.username)
    }
    this.targetPosition.set(state.x, TRACK_SURFACE_HEIGHT + 0.82, state.z)
    this.impactSpinTimeLeft = Math.max(0, state.impactSpinTimeLeft ?? 0)
    this.targetTurboPitch = this.shouldApplyTurboLift(state)
      ? TURBO_LIFT_SETTINGS.liftAngle
      : 0
    if (!this.hasReceivedState) {
      this.currentPosition.copy(this.targetPosition)
      this.lastServerPosition.copy(this.targetPosition)
      this.currentTurboPitch = this.targetTurboPitch
      this.hasReceivedState = true
    }

    const displacement = TEMP_VECTOR.subVectors(this.targetPosition, this.lastServerPosition)
    this.lastServerPosition.copy(this.targetPosition)
    const displacementLengthSq = displacement.lengthSq()

    ANGLE_FORWARD.set(Math.cos(state.angle), 0, Math.sin(state.angle))
    if (ANGLE_FORWARD.lengthSq() < 1e-4) {
      ANGLE_FORWARD.set(0, 0, 1)
    }

    if (displacementLengthSq > 0.0001) {
      const displacementDir = displacement.normalize()
      const normalizedSpeed = THREE.MathUtils.clamp(
        Math.abs(state.speed) / MAX_SPEED_FOR_ALIGNMENT,
        0,
        1,
      )
      const displacementWeight = 0.35 + normalizedSpeed * 0.5
      this.desiredForward.copy(ANGLE_FORWARD)
      this.desiredForward.lerp(displacementDir, displacementWeight)
    } else {
      this.desiredForward.copy(ANGLE_FORWARD)
    }

    this.desiredForward.normalize()
    const yaw = Math.atan2(this.desiredForward.x, this.desiredForward.z)
    // PERF: Reuse Euler to avoid allocations per state update.
    TEMP_EULER.set(0, yaw, 0)
    this.targetOrientation.setFromEuler(TEMP_EULER)

    this.engineSound?.setTargetSpeed(state.speed)
  }

  update(dt: number): void {
    if (!this.hasReceivedState) {
      return
    }
    this.impactSpinTimeLeft = Math.max(0, this.impactSpinTimeLeft - dt)
    const positionLerp = Math.min(1, dt * 60)
    this.currentPosition.lerp(this.targetPosition, positionLerp)

    const rotationLerp = Math.min(1, dt * 60)
    this.orientation.slerp(this.targetOrientation, rotationLerp)

    this.updateTurboPitch(dt)

    if (this.object) {
      const hasTurboPitch = Math.abs(this.currentTurboPitch) > 1e-6
      this.object.position.copy(this.currentPosition)
      this.composedOrientation.copy(this.orientation)
      if (hasTurboPitch) {
        this.pitchQuaternion.setFromAxisAngle(PITCH_AXIS, -this.currentTurboPitch)
        this.composedOrientation.multiply(this.pitchQuaternion)
      }
      this.object.quaternion.copy(this.composedOrientation)

      if (hasTurboPitch && TURBO_PIVOT_HAS_OFFSET) {
        // Offset the pivot so turbo lift rotates around the rear axle instead of the car center.
        TURBO_LIFT_PIVOT_WORLD.copy(TURBO_LIFT_SETTINGS.pivotOffset)
        TURBO_LIFT_PIVOT_WORLD.applyQuaternion(this.orientation)
        TURBO_LIFT_PIVOT_WORLD.add(this.currentPosition)

        TURBO_LIFT_PIVOT_WORLD_AFTER.copy(TURBO_LIFT_SETTINGS.pivotOffset)
        TURBO_LIFT_PIVOT_WORLD_AFTER.applyQuaternion(this.composedOrientation)
        TURBO_LIFT_PIVOT_WORLD_AFTER.add(this.currentPosition)

        this.object.position.add(TURBO_LIFT_PIVOT_WORLD.sub(TURBO_LIFT_PIVOT_WORLD_AFTER))
      }
    }

    this.engineSound?.update(dt, this.currentPosition)
  }

  getObject(): THREE.Object3D | null {
    return this.object
  }

  setVisible(visible: boolean): void {
    this.isVisible = visible
    if (this.object) {
      this.object.visible = visible
    }
  }

  isImpactSpinning(): boolean {
    return this.impactSpinTimeLeft > 0
  }

  dispose(): void {
    this.disposed = true
    if (this.object) {
      this.object.removeFromParent()
      this.object = null
    }

    this.engineSound?.dispose()
    this.destroyNameLabel()
  }

  private setUsername(username: string): void {
    this.username = username
    this.updateNameLabel()
  }

  setNameLabelVisible(visible: boolean): void {
    if (this.showNameLabel === visible) {
      return
    }
    this.showNameLabel = visible
    this.updateNameLabel()
  }

  private updateNameLabel(): void {
    if (!this.object) {
      return
    }

    if (!this.showNameLabel) {
      this.destroyNameLabel()
      return
    }

    const sprite = this.nameSprite ?? this.createNameSprite()

    const texture = this.renderNameTexture(this.username)
    sprite.material.map = texture
    sprite.material.needsUpdate = true
    const aspect = texture.image.width / texture.image.height
    this.nameLabelAspect = aspect
    this.applyNameScale(sprite)
    sprite.position.set(0, 2, 0)
    texture.needsUpdate = true
    this.nameTexture?.dispose()
    this.nameTexture = texture
    this.nameSprite = sprite
    if (!sprite.parent) {
      this.object.add(sprite)
    }
  }

  private renderNameTexture(text: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 160
    const context = canvas.getContext('2d')
    if (!context) {
      return this.nameTexture ?? new THREE.CanvasTexture(canvas)
    }

    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = 'rgba(27, 20, 16, 0.82)'
    const borderColor = new THREE.Color('#f2b24a').lerp(this.color, 0.22)
    context.strokeStyle = borderColor.getStyle()
    context.lineWidth = 8
    context.lineJoin = 'round'

    const radius = 32
    context.beginPath()
    context.moveTo(radius, 0)
    context.lineTo(canvas.width - radius, 0)
    context.quadraticCurveTo(canvas.width, 0, canvas.width, radius)
    context.lineTo(canvas.width, canvas.height - radius)
    context.quadraticCurveTo(canvas.width, canvas.height, canvas.width - radius, canvas.height)
    context.lineTo(radius, canvas.height)
    context.quadraticCurveTo(0, canvas.height, 0, canvas.height - radius)
    context.lineTo(0, radius)
    context.quadraticCurveTo(0, 0, radius, 0)
    context.closePath()
    context.fill()
    context.stroke()

    context.save()
    context.clip()
    const overlay = context.createLinearGradient(0, 0, 0, canvas.height)
    overlay.addColorStop(0, 'rgba(255, 255, 255, 0.12)')
    overlay.addColorStop(1, 'rgba(0, 0, 0, 0.2)')
    context.fillStyle = overlay
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.restore()

    context.strokeStyle = 'rgba(0, 0, 0, 0.55)'
    context.lineWidth = 2
    context.stroke()

    context.font = '700 58px "Rajdhani", "Trebuchet MS", sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillStyle = '#f5efe6'
    context.shadowColor = 'rgba(0, 0, 0, 0.55)'
    context.shadowBlur = 14
    context.shadowOffsetY = 2
    context.fillText(text, canvas.width / 2, canvas.height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    return texture
  }

  private createNameSprite(): THREE.Sprite {
    const material = new THREE.SpriteMaterial({
      depthWrite: false,
      depthTest: false,
      transparent: true,
    })
    if (this.nameTexture) {
      material.map = this.nameTexture
    }
    const sprite = new THREE.Sprite(material)
    sprite.renderOrder = 2
    return sprite
  }

  updateNameLabelScale(camera: THREE.Camera): void {
    if (!this.nameSprite || !this.object || !this.showNameLabel) {
      return
    }
    const distance = camera.position.distanceTo(this.object.position)
    this.currentNameScale = THREE.MathUtils.clamp(
      distance * this.distanceScaleFactor,
      this.minNameScale,
      this.maxNameScale,
    )
    this.applyNameScale(this.nameSprite)
  }

  private applyNameScale(sprite: THREE.Sprite): void {
    const height = this.baseNameHeight * this.currentNameScale
    sprite.scale.set(height * this.nameLabelAspect, height, 1)
  }

  private destroyNameLabel(): void {
    if (this.nameSprite) {
      this.nameSprite.removeFromParent()
      this.nameSprite.material.dispose()
      this.nameSprite = null
    }
    if (this.nameTexture) {
      this.nameTexture.dispose()
      this.nameTexture = null
    }
  }

  private shouldApplyTurboLift(state: CarState): boolean {
    return !!state.turboActive && Math.abs(state.speed) >= TURBO_LIFT_SETTINGS.speedThreshold
  }

  private updateTurboPitch(dt: number): void {
    const delta = this.targetTurboPitch - this.currentTurboPitch
    if (Math.abs(delta) < 1e-4) {
      this.currentTurboPitch = this.targetTurboPitch
      return
    }

    const speed = delta > 0 ? TURBO_LIFT_SETTINGS.raiseSpeed : TURBO_LIFT_SETTINGS.lowerSpeed
    const step = Math.sign(delta) * speed * dt

    if (Math.abs(step) >= Math.abs(delta)) {
      this.currentTurboPitch = this.targetTurboPitch
    } else {
      this.currentTurboPitch += step
    }
  }
}
