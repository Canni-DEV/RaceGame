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

  setBrake(isPressed: boolean): void {
    this.brake = isPressed ? 1 : 0
  }

  setThrottleFromY(relativeY: number): void {
    const clamped = Math.max(0, Math.min(1, relativeY))
    this.throttle = clamped
  }

  updateSteerFromOrientation(rawRoll: number): void {
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
}
