const MAX_STEER_ANGLE = 45

export type ControllerActions = {
  turbo?: boolean
  reset?: boolean
  shoot?: boolean
}

export type ControllerInput = {
  steer: number
  throttle: number
  brake: number
  actions?: ControllerActions
}

export class ControllerInputStore {
  private steer = 0
  private throttle = 0
  private brake = 0
  private calibrationAngle = 0
  private steeringAngle = 0
  private usingManual = false
  private pendingActions: ControllerActions = {}

  setBrake(isPressed: boolean): void {
    this.brake = isPressed ? 1 : 0
  }

  setThrottleFromY(relativeY: number): void {
    const clamped = Math.max(0, Math.min(1, relativeY))
    this.throttle = clamped
  }

  updateSteerFromOrientation(rawRoll: number): void {
    this.usingManual = false
    const delta = rawRoll - this.calibrationAngle
    const clampedAngle = Math.max(-MAX_STEER_ANGLE, Math.min(MAX_STEER_ANGLE, delta))
    this.steeringAngle = clampedAngle
    this.steer = clampedAngle / MAX_STEER_ANGLE
  }

  calibrate(rawRoll: number): void {
    this.calibrationAngle = rawRoll
    this.updateSteerFromOrientation(rawRoll)
  }

  setManualSteer(normalized: number): void {
    this.usingManual = true
    const clamped = Math.max(-1, Math.min(1, normalized))
    this.steer = clamped
    this.steeringAngle = clamped * MAX_STEER_ANGLE
  }

  triggerTurbo(): void {
    this.pendingActions.turbo = true
  }

  triggerReset(): void {
    this.pendingActions.reset = true
  }

  triggerShoot(): void {
    this.pendingActions.shoot = true
  }

  private consumeActions(): ControllerActions | undefined {
    const actions = { ...this.pendingActions }
    this.pendingActions = {}
    if (!actions.turbo && !actions.reset && !actions.shoot) {
      return undefined
    }
    return actions
  }

  resetSteering(): void {
    this.usingManual = false
    this.steer = 0
    this.steeringAngle = 0
  }

  getCurrentInput(): ControllerInput {
    return {
      steer: this.steer,
      throttle: this.throttle,
      brake: this.brake,
      actions: this.consumeActions(),
    }
  }

  getSteeringAngle(): number {
    return this.steeringAngle
  }

  isManualSteer(): boolean {
    return this.usingManual
  }
}
