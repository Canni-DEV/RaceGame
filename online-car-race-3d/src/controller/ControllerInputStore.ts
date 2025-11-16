const MAX_STEER_ANGLE = 45

export type ControllerInput = {
  steer: number
  throttle: number
  brake: number
}

export class ControllerInputStore {
  private steer = 0
  private throttle = 0
  private brake = 0
  private calibrationAngle = 0
  private steeringAngle = 0
  private lastRawRoll = 0
  private usingManual = false

  setBrake(isPressed: boolean): void {
    this.brake = isPressed ? 1 : 0
  }

  setThrottleFromY(relativeY: number): void {
    const clamped = Math.max(0, Math.min(1, relativeY))
    this.throttle = clamped
  }

  updateSteerFromOrientation(rawRoll: number): void {
    this.usingManual = false
    this.lastRawRoll = rawRoll
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
    }
  }

  getSteeringAngle(): number {
    return this.steeringAngle
  }

  getLastRawRoll(): number {
    return this.lastRawRoll
  }

  isManualSteer(): boolean {
    return this.usingManual
  }
}
