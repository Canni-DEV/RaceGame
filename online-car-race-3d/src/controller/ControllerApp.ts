import './controller.css'
import { ControllerInputStore } from './ControllerInputStore'
import { ControllerSocketClient } from './ControllerSocketClient'
import { OrientationManager } from './OrientationManager'

const INPUT_SEND_INTERVAL_MS = 100

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
  private readonly statusText: HTMLElement

  private readonly inputStore = new ControllerInputStore()
  private readonly orientationManager = new OrientationManager()
  private readonly socketClient: ControllerSocketClient | null

  private readonly needsPermission: boolean

  private permissionGranted: boolean
  private isLandscape = false
  private errorMessage: string | null = null
  private sensorsActive = false
  private pendingCalibration = true
  private throttlePointerId: number | null = null
  private brakePointerId: number | null = null
  private orientationAngle = 0
  private lastRollValue = 0
  private readonly sendIntervalId: number
  private readonly removeOrientationListener: () => void
  private readonly hasRoomParameters: boolean

  constructor(container: HTMLElement) {
    this.container = container
    this.container.innerHTML = ''

    this.root = createElement('div', 'controller-root')
    this.container.appendChild(this.root)

    const layout = createElement('div', 'controller-layout')
    this.root.appendChild(layout)

    this.brakeZone = this.createBrakeZone()
    layout.appendChild(this.brakeZone)

    const steeringZone = this.createSteeringZone()
    layout.appendChild(steeringZone)

    this.throttleZone = this.createThrottleZone()
    layout.appendChild(this.throttleZone)

    this.overlay = createElement('div', 'controller-overlay')
    this.overlayMessage = createElement('div', 'controller-overlay__message')
    this.overlayDetails = createElement('div', 'controller-overlay__details')
    this.permissionButton = createElement('button', 'controller-overlay__button')
    this.permissionButton.textContent = 'Activar sensores'
    this.permissionButton.type = 'button'
    this.permissionButton.addEventListener('click', () => {
      this.requestSensorPermission()
    })

    this.overlay.appendChild(this.overlayMessage)
    this.overlay.appendChild(this.overlayDetails)
    this.overlay.appendChild(this.permissionButton)
    this.root.appendChild(this.overlay)

    const params = new URLSearchParams(window.location.search)
    const roomId = params.get('roomId') ?? ''
    const playerId = params.get('playerId') ?? ''
    const serverUrl = params.get('serverUrl') ?? params.get('server') ?? undefined
    this.hasRoomParameters = Boolean(roomId && playerId)

    this.statusText = createElement('div', 'controller-status')
    steeringZone.appendChild(this.statusText)

    if (this.hasRoomParameters) {
      this.statusText.textContent = `Room ${roomId} · Player ${playerId}`
      this.socketClient = new ControllerSocketClient({ roomId, playerId, serverUrl })
      this.socketClient.onError((message) => {
        this.errorMessage = message
        this.updateOverlay()
      })
      this.socketClient.onRoomInfo((info) => {
        this.errorMessage = null
        this.statusText.textContent = `Room ${info.roomId} · Player ${info.playerId}`
        this.updateOverlay()
      })
      this.socketClient.onConnect(() => {
        this.errorMessage = null
        this.updateOverlay()
      })
      this.socketClient.connect()
    } else {
      this.statusText.textContent = 'Faltan roomId/playerId en la URL'
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

    window.addEventListener('deviceorientation', this.handleDeviceOrientation, true)
    window.addEventListener('beforeunload', this.handleBeforeUnload)

    this.sendIntervalId = window.setInterval(() => {
      this.pushInput()
    }, INPUT_SEND_INTERVAL_MS)

    this.updateSteeringVisual()
    this.updateOverlay()
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
    const label = createElement('div', 'controller-zone__label')
    label.textContent = 'Throttle'
    zone.appendChild(label)

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

    const calibrateButton = createElement('button', 'controller-calibrate-button')
    calibrateButton.type = 'button'
    calibrateButton.textContent = 'Calibrar'
    calibrateButton.addEventListener('click', () => {
      this.inputStore.calibrate(this.lastRollValue)
      this.pendingCalibration = false
      this.updateSteeringVisual()
    })
    zone.appendChild(calibrateButton)

    return zone
  }

  private updateSensorsState(): void {
    this.sensorsActive = this.isLandscape && this.permissionGranted
    if (!this.sensorsActive) {
      this.inputStore.setBrake(false)
      this.brakeZone.classList.remove('is-active')
      this.inputStore.setThrottleFromY(0)
      this.updateThrottleVisual(0)
    }
  }

  private updateOverlay(): void {
    let message = ''
    let details = ''
    let showButton = false

    if (!this.hasRoomParameters) {
      message = 'Configura el acceso a la sala'
      details = 'Agrega roomId y playerId en la URL para continuar.'
    } else if (!this.isLandscape) {
      message = 'Girá el teléfono'
      details = 'Usa el controlador en orientación horizontal.'
    } else if (!this.permissionGranted) {
      message = 'Permite el acceso a los sensores'
      details = 'Necesitamos leer la orientación del dispositivo para el volante.'
      showButton = true
    } else if (this.errorMessage) {
      message = 'Sin conexión'
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

    if (showButton) {
      this.permissionButton.classList.remove('is-hidden')
    } else {
      this.permissionButton.classList.add('is-hidden')
    }
  }

  private updateThrottleVisual(value: number): void {
    const percent = (1 - clamp01(value)) * 100
    this.throttleThumb.style.setProperty('--thumb-percent', `${percent}%`)
  }

  private updateSteeringVisual(): void {
    const angle = this.inputStore.getSteeringAngle()
    this.steeringOuter.style.transform = `rotate(${angle}deg)`
    this.steeringBar.style.transform = `rotate(${-angle}deg)`
  }

  private handleDeviceOrientation = (event: DeviceOrientationEvent): void => {
    if (!this.sensorsActive) {
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

  private pushInput(): void {
    if (!this.socketClient) {
      return
    }
    const input = this.inputStore.getCurrentInput()
    this.socketClient.sendInput(input)
  }

  private handleBeforeUnload = (): void => {
    window.clearInterval(this.sendIntervalId)
    this.orientationManager.stop()
    this.removeOrientationListener()
    window.removeEventListener('deviceorientation', this.handleDeviceOrientation, true)
    window.removeEventListener('beforeunload', this.handleBeforeUnload)
    this.socketClient?.disconnect()
  }
}
