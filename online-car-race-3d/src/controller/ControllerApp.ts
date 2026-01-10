import './controller.css'
import { ControllerInputStore } from './ControllerInputStore'
import { ControllerSocketClient } from './ControllerSocketClient'
import { OrientationManager } from './OrientationManager'
import type { RaceState, RoomState, RoomStateDelta } from '../core/trackTypes'
import type { PlayerSummary } from '../net/messages'
import { applyRoomStateDelta } from '../state/StateRebuilder'

const INPUT_SEND_INTERVAL_MS = 33
const SENSOR_PULSE_TIMEOUT_MS = 2000
const SHOOT_COOLDOWN_MS = 2000
const TURBO_COOLDOWN_MS = 400

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) {
    element.className = className
  }
  return element
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export class ControllerApp {
  private readonly container: HTMLElement
  private readonly root: HTMLElement
  private readonly brakeZone: HTMLElement
  private readonly throttleZone: HTMLElement
  private throttleThumb!: HTMLElement
  private steeringOuter!: HTMLElement
  private steeringBar!: HTMLElement
  private readonly overlay: HTMLElement
  private readonly overlayMessage: HTMLElement
  private readonly overlayDetails: HTMLElement
  private readonly permissionButton: HTMLButtonElement
  private usernameForm: HTMLElement | null = null
  private usernameInput: HTMLInputElement | null = null
  private usernameButton: HTMLButtonElement | null = null
  private usernameStatus: HTMLElement | null = null
  private readonly statusText: HTMLElement
  private steeringStatus!: HTMLElement
  private steeringHint!: HTMLElement
  private calibrateButton!: HTMLButtonElement
  private raceStatus!: HTMLElement
  private lastRaceState: RaceState | null = null
  private lastRoomState: RoomState | null = null
  private raceInputBlocked = false
  private readonly roomId: string
  private readonly playerId: string
  private playerUsername: string
  private overlayAction: 'permission' | 'refresh' | null = null
  private hasRoomInfo = false

  private readonly inputStore = new ControllerInputStore()
  private readonly orientationManager = new OrientationManager()
  private readonly socketClient: ControllerSocketClient | null
  private readonly orientationEventNames = ['deviceorientation', 'deviceorientationabsolute']

  private readonly needsPermission: boolean
  private readonly secureContext: boolean
  private readonly sensorsSupported: boolean

  private permissionGranted: boolean
  private isLandscape = false
  private errorMessage: string | null = null
  private sensorsActive = false
  private pendingCalibration = true
  private throttlePointerId: number | null = null
  private brakePointerId: number | null = null
  private manualSteerPointerId: number | null = null
  private manualSteerActive = false
  private orientationAngle = 0
  private lastRollValue = 0
  private sensorAvailable = false
  private sensorPulseTimeoutId: number | null = null
  private readonly sendIntervalId: number
  private readonly removeOrientationListener: () => void
  private readonly hasRoomParameters: boolean
  private lastShootAt = 0
  private lastTurboAt = 0

  constructor(container: HTMLElement) {
    this.container = container
    this.container.innerHTML = ''
    this.secureContext = typeof window !== 'undefined' ? window.isSecureContext ?? false : false
    this.sensorsSupported =
      typeof window !== 'undefined' && 'DeviceOrientationEvent' in window

    this.root = createElement('div', 'controller-root')
    this.container.appendChild(this.root)
    this.disableContextInteractions()

    this.playerUsername = ''

    const layout = createElement('div', 'controller-layout')
    this.root.appendChild(layout)

    this.brakeZone = this.createBrakeZone()
    layout.appendChild(this.brakeZone)

    const steeringZone = this.createSteeringZone()
    layout.appendChild(steeringZone)

    this.throttleZone = this.createThrottleZone()
    layout.appendChild(this.throttleZone)

    const actionBar = this.createActionBar()
    this.root.appendChild(actionBar)

    this.overlay = createElement('div', 'controller-overlay')
    this.overlayMessage = createElement('div', 'controller-overlay__message')
    this.overlayDetails = createElement('div', 'controller-overlay__details')
    this.permissionButton = createElement('button', 'controller-overlay__button')
    this.permissionButton.textContent = 'Enable sensors'
    this.permissionButton.type = 'button'
    this.permissionButton.onclick = () => this.handleOverlayButton()

    this.overlay.appendChild(this.overlayMessage)
    this.overlay.appendChild(this.overlayDetails)
    this.overlay.appendChild(this.permissionButton)
    this.usernameForm = this.createUsernameForm()
    this.overlay.appendChild(this.usernameForm)
    this.root.appendChild(this.overlay)

    const params = new URLSearchParams(window.location.search)
    const roomId = params.get('roomId') ?? ''
    const playerId = params.get('playerId') ?? ''
    const sessionToken = params.get('sessionToken') ?? undefined
    this.roomId = roomId
    this.playerId = playerId
    this.playerUsername = playerId
    this.syncUsernameInput(true)
    const serverUrl = params.get('serverUrl') ?? params.get('server') ?? undefined
    this.hasRoomParameters = Boolean(roomId && playerId)

    this.statusText = createElement('div', 'controller-status')
    steeringZone.appendChild(this.statusText)
    this.raceStatus = createElement('div', 'controller-race-status')
    steeringZone.appendChild(this.raceStatus)

    if (this.hasRoomParameters) {
      this.statusText.textContent = `Room ${roomId} · ${this.playerUsername}`
      this.socketClient = new ControllerSocketClient({ roomId, playerId, serverUrl, sessionToken })
      this.socketClient.onError((message) => {
        this.errorMessage = message
        this.hasRoomInfo = false
        this.updateOverlay()
      })
      this.socketClient.onRoomInfo((info) => {
        this.errorMessage = null
        this.hasRoomInfo = true
        this.playerUsername = this.resolveUsername(info.players, info.playerId)
        this.syncUsernameInput(true)
        this.statusText.textContent = `Room ${info.roomId} · ${this.playerUsername}`
        this.updateOverlay()
      })
      this.socketClient.onState((state) => {
        this.handleFullState(state)
      })
      this.socketClient.onStateDelta((delta) => {
        this.handleStateDelta(delta)
      })
      this.socketClient.onPlayerUpdate((event) => {
        if (event.playerId !== this.playerId) {
          return
        }
        this.playerUsername = event.username
        this.syncUsernameInput(true)
        this.statusText.textContent = `Room ${this.roomId} · ${this.playerUsername}`
      })
      this.socketClient.onConnect(() => {
        this.errorMessage = null
        this.syncUsernameInput()
        this.updateOverlay()
      })
      this.socketClient.connect()
    } else {
      this.statusText.textContent = 'Missing roomId/playerId in the URL'
      this.socketClient = null
    }

    this.needsPermission = this.orientationManager.needsPermission()
    this.permissionGranted = !this.needsPermission

    this.removeOrientationListener = this.orientationManager.addListener((landscape) => {
      this.isLandscape = landscape
      this.orientationAngle = this.orientationManager.getOrientationAngle()
      this.pendingCalibration = true
      this.updateSensorsState()
      this.updateOverlay()
    })
    this.orientationManager.start()
    this.orientationAngle = this.orientationManager.getOrientationAngle()
    this.isLandscape = this.orientationManager.isLandscape()
    this.updateSensorsState()
    this.updateRaceStatus()

    for (const eventName of this.orientationEventNames) {
      window.addEventListener(
        eventName,
        this.handleDeviceOrientation as EventListener,
        true,
      )
    }
    window.addEventListener('beforeunload', this.handleBeforeUnload)

    this.sendIntervalId = window.setInterval(() => {
      this.pushInput()
    }, INPUT_SEND_INTERVAL_MS)

    this.updateSteeringVisual()
    this.updateSensorStatus()
    this.updateOverlay()
    this.syncUsernameInput()
  }

  private disableContextInteractions(): void {
    const preventDefault = (event: Event): void => event.preventDefault()
    this.root.addEventListener('contextmenu', preventDefault)
    this.root.addEventListener('gesturestart', preventDefault as EventListener, { passive: false })
    this.root.addEventListener('gesturechange', preventDefault as EventListener, { passive: false })
    this.root.addEventListener('gestureend', preventDefault as EventListener, { passive: false })
  }

  private createBrakeZone(): HTMLElement {
    const zone = createElement('div', 'controller-zone controller-zone--brake')
    const label = createElement('div', 'controller-zone__label')
    label.textContent = 'Brake'
    zone.appendChild(label)

    zone.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      if (!this.sensorsActive) {
        return
      }
      if (this.brakePointerId !== null) {
        return
      }
      this.brakePointerId = event.pointerId
      zone.setPointerCapture(event.pointerId)
      this.inputStore.setBrake(true)
      zone.classList.add('is-active')
    })

    const endBrake = (event: PointerEvent) => {
      if (this.brakePointerId !== event.pointerId) {
        return
      }
      this.brakePointerId = null
      this.inputStore.setBrake(false)
      zone.classList.remove('is-active')
      zone.releasePointerCapture(event.pointerId)
    }

    zone.addEventListener('pointerup', (event) => {
      event.preventDefault()
      endBrake(event)
    })
    zone.addEventListener('pointercancel', (event) => {
      event.preventDefault()
      endBrake(event)
    })

    return zone
  }

  private createThrottleZone(): HTMLElement {
    const zone = createElement('div', 'controller-zone controller-zone--throttle')
    const track = createElement('div', 'controller-throttle-track')
    this.throttleThumb = createElement('div', 'controller-throttle-thumb')
    track.appendChild(this.throttleThumb)
    zone.appendChild(track)

    const updateFromEvent = (event: PointerEvent) => {
      if (!this.sensorsActive) {
        return
      }
      const rect = zone.getBoundingClientRect()
      const relative = clamp01((rect.bottom - event.clientY) / rect.height)
      this.inputStore.setThrottleFromY(relative)
      this.updateThrottleVisual(relative)
    }

    zone.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      if (!this.sensorsActive) {
        return
      }
      this.throttlePointerId = event.pointerId
      zone.setPointerCapture(event.pointerId)
      zone.classList.add('is-active')
      updateFromEvent(event)
    })

    zone.addEventListener('pointermove', (event) => {
      if (event.pointerId !== this.throttlePointerId) {
        return
      }
      event.preventDefault()
      updateFromEvent(event)
    })

    const finishThrottle = (event: PointerEvent) => {
      if (event.pointerId !== this.throttlePointerId) {
        return
      }
      updateFromEvent(event)
      zone.releasePointerCapture(event.pointerId)
      this.throttlePointerId = null
      zone.classList.remove('is-active')
    }

    zone.addEventListener('pointerup', (event) => {
      event.preventDefault()
      finishThrottle(event)
    })

    zone.addEventListener('pointercancel', (event) => {
      event.preventDefault()
      finishThrottle(event)
    })

    this.updateThrottleVisual(0)

    return zone
  }

  private createActionButton(
    label: string,
    className: string,
    onPress: () => void,
  ): HTMLButtonElement {
    const button = createElement('button', className)
    button.type = 'button'
    button.textContent = label
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      onPress()
    })
    button.addEventListener('click', (event) => {
      event.preventDefault()
      onPress()
    })
    return button
  }

  private createActionBar(): HTMLElement {
    const bar = createElement('div', 'controller-actions')
    const leftGroup = createElement('div', 'controller-actions__group controller-actions__group--left')
    const centerGroup = createElement('div', 'controller-actions__group controller-actions__group--center')
    const rightGroup = createElement('div', 'controller-actions__group controller-actions__group--right')

    const turboButton = this.createActionButton(
      'Turbo',
      'controller-action controller-action--turbo',
      () => this.triggerTurbo(),
    )

    const resetButton = this.createActionButton(
      'Reset',
      'controller-action controller-action--reset',
      () => this.triggerReset(),
    )

    const shootButton = this.createActionButton(
      'Shoot',
      'controller-action controller-action--shoot',
      () => this.triggerShoot(),
    )

    leftGroup.appendChild(turboButton)
    centerGroup.appendChild(resetButton)
    rightGroup.appendChild(shootButton)

    bar.appendChild(leftGroup)
    bar.appendChild(centerGroup)
    bar.appendChild(rightGroup)
    return bar
  }

  private createUsernameForm(): HTMLElement {
    const container = createElement('div', 'controller-username')
    container.hidden = true

    const label = createElement('label', 'controller-username__label')
    const inputId = 'controller-username-input'
    label.textContent = 'In-game name'
    label.setAttribute('for', inputId)

    const input = document.createElement('input')
    input.className = 'controller-username__input'
    input.id = inputId
    input.type = 'text'
    input.maxLength = 24
    input.placeholder = 'Player'
    input.value = this.playerUsername
    input.addEventListener('input', () => this.syncUsernameInput())

    const button = createElement('button', 'controller-username__button') as HTMLButtonElement
    button.type = 'button'
    button.textContent = 'Update name'
    button.addEventListener('click', (event) => {
      event.preventDefault()
      this.handleUsernameSubmit()
    })

    const status = createElement('div', 'controller-username__status')

    container.appendChild(label)
    container.appendChild(input)
    container.appendChild(button)
    container.appendChild(status)

    this.usernameInput = input
    this.usernameButton = button
    this.usernameStatus = status
    this.syncUsernameInput(true)

    return container
  }

  private createSteeringZone(): HTMLElement {
    const zone = createElement('div', 'controller-zone controller-zone--steering')

    const wheelWrapper = createElement('div', 'controller-steering')
    this.steeringOuter = createElement('div', 'controller-steering__outer')
    const tick = createElement('div', 'controller-steering__tick')
    const rim = createElement('div', 'controller-steering__rim')
    this.steeringBar = createElement('div', 'controller-steering__bar')

    this.steeringOuter.appendChild(rim)
    this.steeringOuter.appendChild(tick)
    wheelWrapper.appendChild(this.steeringOuter)
    wheelWrapper.appendChild(this.steeringBar)
    zone.appendChild(wheelWrapper)

    this.steeringOuter.addEventListener('pointerdown', this.handleManualSteerStart)
    this.steeringOuter.addEventListener('pointermove', this.handleManualSteerMove)
    this.steeringOuter.addEventListener('pointerup', this.handleManualSteerEnd)
    this.steeringOuter.addEventListener('pointercancel', this.handleManualSteerEnd)

    this.calibrateButton = createElement('button', 'controller-calibrate-button')
    this.calibrateButton.type = 'button'
    this.calibrateButton.textContent = 'Calibrate'
    this.calibrateButton.addEventListener('click', () => {
      this.inputStore.calibrate(this.lastRollValue)
      this.pendingCalibration = false
      this.updateSteeringVisual()
    })
    zone.appendChild(this.calibrateButton)

    this.steeringStatus = createElement('div', 'controller-steering-status')
    this.steeringHint = createElement('div', 'controller-steering-hint')
    this.steeringStatus.textContent = 'Sensors inactive'
    this.steeringHint.textContent = 'Keep the bar parallel to the floor'
    zone.appendChild(this.steeringStatus)
    zone.appendChild(this.steeringHint)

    return zone
  }

  private triggerTurbo(): void {
    if (!this.sensorsActive) {
      return
    }
    const now = performance.now()
    if (now - this.lastTurboAt < TURBO_COOLDOWN_MS) {
      return
    }
    this.lastTurboAt = now
    this.inputStore.triggerTurbo()
  }

  private triggerReset(): void {
    if (!this.sensorsActive) {
      return
    }
    this.inputStore.triggerReset()
  }

  private triggerShoot(): void {
    if (!this.sensorsActive) {
      return
    }
    const now = performance.now()
    if (now - this.lastShootAt < SHOOT_COOLDOWN_MS) {
      return
    }
    this.lastShootAt = now
    this.inputStore.triggerShoot()
  }

  private handleFullState(state: RoomState): void {
    this.lastRoomState = state
    this.lastRaceState = state.race
    this.updateRaceStatus()
  }

  private handleStateDelta(delta: RoomStateDelta): void {
    const merged = applyRoomStateDelta(this.lastRoomState, delta)
    if (!merged) {
      this.socketClient?.requestStateFull(this.roomId)
      return
    }
    this.handleFullState(merged)
  }

  private updateRaceStatus(): void {
    if (!this.raceStatus) {
      return
    }

    const race = this.lastRaceState
    if (!race) {
      this.raceStatus.textContent = 'Waiting for race state'
      this.raceInputBlocked = false
      return
    }

    const humans = race.players.filter((p) => !p.isNpc)
    const readyCount = humans.filter((p) => p.ready).length
    const me =
      race.leaderboard.find((entry) => entry.playerId === this.playerId) ??
      race.players.find((entry) => entry.playerId === this.playerId)

    let message = 'Open lobby'
    if (race.phase === 'lobby') {
      message =
        humans.length === 0
          ? 'Open lobby'
          : `Lobby · Ready ${readyCount}/${humans.length}`
      this.raceInputBlocked = false
    } else if (race.phase === 'countdown') {
      const time = race.countdownRemaining ?? 0
      message = `Starting soon · ${time.toFixed(1)}s`
      this.raceInputBlocked = true
    } else if (race.phase === 'race') {
      const lapText = me ? `L${me.lap}/${race.lapsRequired}` : `Laps ${race.lapsRequired}`
      const finished = Boolean(me?.isFinished)
      message = finished ? 'Race finished' : `Race · ${lapText}`
      this.raceInputBlocked = finished
    } else {
      const remaining = race.postRaceRemaining ?? 0
      message = `Results · ${remaining.toFixed(1)}s`
      this.raceInputBlocked = true
    }

    this.raceStatus.textContent = message
  }

  private updateSensorsState(): void {
    this.sensorsActive = this.isLandscape && this.permissionGranted
    if (!this.sensorsActive) {
      this.inputStore.setBrake(false)
      this.brakeZone.classList.remove('is-active')
      this.inputStore.setThrottleFromY(0)
      this.updateThrottleVisual(0)
      this.inputStore.resetSteering()
      this.updateSteeringVisual()
      this.resetSensorAvailability()
    }
    this.updateSensorStatus()
  }

  private updateOverlay(): void {
    let message = ''
    let details = ''
    let showButton = false
    this.overlayAction = null

    const raceBlocked = this.errorMessage ? this.isRaceBlockedError(this.errorMessage) : false

    if (!this.hasRoomParameters) {
      message = 'Set up room access'
      details = 'Add roomId and playerId in the URL to continue.'
    } else if (raceBlocked) {
      message = 'Race in progress'
      details = 'Wait for the race to finish and refresh the controller to enter the lobby.'
      showButton = true
      this.overlayAction = 'refresh'
    } else if (!this.isLandscape) {
      message = 'Rotate your phone'
      details = 'Use the controller in landscape. In portrait you can edit your name.'
    } else if (!this.permissionGranted) {
      message = 'Allow sensor access'
      details = 'We need to read the device orientation for steering.'
      showButton = true
      this.overlayAction = 'permission'
    } else if (this.errorMessage) {
      message = 'Disconnected'
      details = this.errorMessage
    } else {
      message = ''
      details = ''
    }

    if (message) {
      this.overlay.classList.remove('is-hidden')
      this.overlayMessage.textContent = message
      this.overlayDetails.textContent = details
    } else {
      this.overlay.classList.add('is-hidden')
      this.overlayMessage.textContent = ''
      this.overlayDetails.textContent = ''
    }

    this.updateUsernameFormVisibility()

    if (showButton) {
      if (this.overlayAction === 'refresh') {
        this.permissionButton.textContent = 'Refresh'
      } else {
        this.permissionButton.textContent = 'Enable sensors'
      }
      this.permissionButton.classList.remove('is-hidden')
    } else {
      this.permissionButton.classList.add('is-hidden')
    }
  }

  private shouldShowUsernameForm(): boolean {
    return this.hasRoomParameters && !this.isLandscape
  }

  private updateUsernameFormVisibility(): void {
    if (!this.usernameForm) {
      return
    }
    const visible = this.shouldShowUsernameForm()
    this.usernameForm.hidden = !visible
    this.usernameForm.classList.toggle('is-visible', visible)
    if (visible) {
      this.syncUsernameInput()
    }
  }

  private handleUsernameSubmit(): void {
    if (!this.usernameInput || !this.usernameStatus) {
      return
    }
    const desired = this.usernameInput.value.trim()
    if (!desired) {
      this.usernameStatus.textContent = 'Enter a valid name.'
      return
    }
    if (desired === this.playerUsername) {
      this.usernameStatus.textContent = 'You are already using that name.'
      return
    }
    if (!this.socketClient || !this.socketClient.isConnected()) {
      this.usernameStatus.textContent = 'Connecting to server...'
      return
    }

    this.usernameStatus.textContent = 'Updating name...'
    this.socketClient.updateUsername(desired)
  }

  private syncUsernameInput(forceValue = false): void {
    if (!this.usernameInput || !this.usernameButton || !this.usernameStatus) {
      return
    }

    if (forceValue) {
      this.usernameInput.value = this.playerUsername
    }
    const proposed = this.usernameInput.value.trim()
    const connected = this.socketClient?.isConnected() ?? false
    const ready = connected && this.hasRoomParameters

    this.usernameButton.disabled = !ready || !proposed || proposed === this.playerUsername

    if (!ready) {
      this.usernameStatus.textContent = 'Connecting to server...'
    } else if (!proposed) {
      this.usernameStatus.textContent = 'Enter a name to show in the race.'
    } else if (proposed === this.playerUsername) {
      this.usernameStatus.textContent = 'This is your current name.'
    } else {
      this.usernameStatus.textContent = 'Tap update to share your name.'
    }
  }

  private resolveUsername(players: PlayerSummary[], fallback: string): string {
    const current = players.find((player) => player.playerId === this.playerId)
    return current?.username ?? fallback
  }

  private isRaceBlockedError(message: string): boolean {
    const normalized = message.toLowerCase()
    return normalized.includes('carrera en curso') || normalized.includes('race in progress')
  }

  private updateThrottleVisual(value: number): void {
    const percent = (1 - clamp01(value)) * 100
    this.throttleThumb.style.setProperty('--thumb-percent', `${percent}%`)
  }

  private updateSteeringVisual(): void {
    const angle = this.inputStore.getSteeringAngle()
    this.steeringOuter.style.transform = `rotate(${angle}deg)`
    this.steeringBar.style.transform = `rotate(${-angle}deg)`
    const isManual = this.inputStore.isManualSteer()
    this.steeringOuter.classList.toggle('is-manual', isManual)
    this.steeringBar.classList.toggle('is-manual', isManual)
    this.updateSensorStatus()
  }

  private updateSensorStatus(): void {
    if (!this.steeringStatus || !this.steeringHint) {
      return
    }

    let status = ''
    let hint = ''
    let manualAllowed = this.shouldAllowManualSteer()

    if (!this.sensorsSupported) {
      status = 'Sensors not supported in this browser'
      hint = 'Drag the wheel to steer manually.'
      manualAllowed = true
    } else if (!this.secureContext) {
      status = 'HTTPS required to enable sensors'
      hint = 'Open the app with https:// or drag the touch wheel.'
      manualAllowed = true
    } else if (!this.sensorsActive) {
      status = 'Rotate your phone and allow sensor access'
      hint = 'Keep the phone in landscape orientation.'
      manualAllowed = false
    } else if (this.sensorAvailable) {
      const angle = this.inputStore.getSteeringAngle().toFixed(0)
      status = `Sensors active · ${angle}°`
      hint = 'Keep the bar parallel to the floor.'
      manualAllowed = false
    } else {
      status = 'Waiting for sensor data...'
      hint = 'You can drag the wheel in the meantime.'
      manualAllowed = true
    }

    this.steeringStatus.textContent = status
    this.steeringHint.textContent = hint
    this.steeringHint.classList.toggle('is-warning', manualAllowed)
    if (this.calibrateButton) {
      this.calibrateButton.disabled = !this.sensorAvailable
    }
  }

  private shouldAllowManualSteer(): boolean {
    if (!this.sensorsActive) {
      return true
    }
    if (!this.sensorsSupported || !this.secureContext) {
      return true
    }
    return !this.sensorAvailable
  }

  private applyManualSteer(event: PointerEvent): void {
    const rect = this.steeringOuter.getBoundingClientRect()
    if (!rect.width) {
      return
    }
    const ratio = (event.clientX - rect.left) / rect.width
    const normalized = Math.max(-1, Math.min(1, ratio * 2 - 1))
    this.inputStore.setManualSteer(normalized)
    this.updateSteeringVisual()
  }

  private readonly handleManualSteerStart = (event: PointerEvent): void => {
    if (!this.shouldAllowManualSteer()) {
      return
    }
    event.preventDefault()
    this.manualSteerPointerId = event.pointerId
    this.manualSteerActive = true
    this.steeringOuter.setPointerCapture(event.pointerId)
    this.applyManualSteer(event)
  }

  private readonly handleManualSteerMove = (event: PointerEvent): void => {
    if (!this.manualSteerActive || this.manualSteerPointerId !== event.pointerId) {
      return
    }
    event.preventDefault()
    this.applyManualSteer(event)
  }

  private readonly handleManualSteerEnd = (event: PointerEvent): void => {
    if (this.manualSteerPointerId !== event.pointerId) {
      return
    }
    event.preventDefault()
    this.manualSteerActive = false
    this.manualSteerPointerId = null
    this.steeringOuter.releasePointerCapture(event.pointerId)
  }

  private cancelManualSteer(): void {
    if (this.manualSteerPointerId !== null) {
      try {
        this.steeringOuter.releasePointerCapture(this.manualSteerPointerId)
      } catch (error) {
        // ignore if capture was already released
      }
    }
    this.manualSteerPointerId = null
    this.manualSteerActive = false
  }

  private markSensorPulse(): void {
    this.sensorAvailable = true
    if (this.sensorPulseTimeoutId !== null) {
      window.clearTimeout(this.sensorPulseTimeoutId)
      this.sensorPulseTimeoutId = null
    }
    this.sensorPulseTimeoutId = window.setTimeout(() => {
      this.sensorAvailable = false
      this.updateSensorStatus()
    }, SENSOR_PULSE_TIMEOUT_MS)
    this.cancelManualSteer()
    this.updateSensorStatus()
  }

  private resetSensorAvailability(): void {
    this.sensorAvailable = false
    if (this.sensorPulseTimeoutId !== null) {
      window.clearTimeout(this.sensorPulseTimeoutId)
      this.sensorPulseTimeoutId = null
    }
    this.updateSensorStatus()
  }

  private handleDeviceOrientation = (event: DeviceOrientationEvent): void => {
    if (!this.sensorsActive || !this.secureContext || !this.sensorsSupported) {
      return
    }
    const roll = this.extractRoll(event)
    this.lastRollValue = roll
    if (this.pendingCalibration) {
      this.inputStore.calibrate(roll)
      this.pendingCalibration = false
    } else {
      this.inputStore.updateSteerFromOrientation(roll)
    }
    this.updateSteeringVisual()
    this.markSensorPulse()
  }

  private extractRoll(event: DeviceOrientationEvent): number {
    const beta = event.beta ?? 0
    const gamma = event.gamma ?? 0
    const angle = this.orientationAngle

    if (angle === 90) {
      return beta
    }
    if (angle === 270) {
      return -beta
    }
    if (Math.abs(beta) > Math.abs(gamma)) {
      return beta
    }
    return gamma
  }

  private async requestSensorPermission(): Promise<void> {
    if (!this.needsPermission) {
      return
    }
    const granted = await this.orientationManager.requestPermission()
    this.permissionGranted = granted
    this.pendingCalibration = true
    this.updateSensorsState()
    this.updateOverlay()
  }

  private handleOverlayButton(): void {
    if (this.overlayAction === 'refresh') {
      window.location.reload()
      return
    }
    if (this.overlayAction === 'permission') {
      void this.requestSensorPermission()
    }
  }

  private pushInput(): void {
    if (!this.socketClient || !this.hasRoomInfo || this.raceInputBlocked) {
      return
    }
    const input = this.inputStore.getCurrentInput()
    this.socketClient.sendInput(input)
  }

  private handleBeforeUnload = (): void => {
    window.clearInterval(this.sendIntervalId)
    this.orientationManager.stop()
    this.removeOrientationListener()
    for (const eventName of this.orientationEventNames) {
      window.removeEventListener(
        eventName,
        this.handleDeviceOrientation as EventListener,
        true,
      )
    }
    if (this.sensorPulseTimeoutId !== null) {
      window.clearTimeout(this.sensorPulseTimeoutId)
    }
    window.removeEventListener('beforeunload', this.handleBeforeUnload)
    this.socketClient?.disconnect()
  }
}
