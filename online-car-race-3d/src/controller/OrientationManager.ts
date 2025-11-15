export type OrientationChangeHandler = (isLandscape: boolean) => void

function supportsPermissionRequest(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof (DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<'granted' | 'denied'>
    }).requestPermission === 'function'
  )
}

function readLegacyOrientation(): number | null {
  const legacy = (window as unknown as { orientation?: number }).orientation
  if (typeof legacy === 'number') {
    const normalized = legacy % 360
    return normalized < 0 ? normalized + 360 : normalized
  }
  return null
}

export class OrientationManager {
  private readonly listeners = new Set<OrientationChangeHandler>()
  private readonly handleChangeBound = () => {
    const landscape = this.isLandscape()
    for (const listener of this.listeners) {
      listener(landscape)
    }
  }

  start(): void {
    if (typeof window === 'undefined') {
      return
    }
    window.addEventListener('resize', this.handleChangeBound)
    window.addEventListener('orientationchange', this.handleChangeBound)
    const screenOrientation = window.screen?.orientation
    if (screenOrientation && typeof screenOrientation.addEventListener === 'function') {
      screenOrientation.addEventListener('change', this.handleChangeBound)
    }
    this.handleChangeBound()
  }

  stop(): void {
    if (typeof window === 'undefined') {
      return
    }
    window.removeEventListener('resize', this.handleChangeBound)
    window.removeEventListener('orientationchange', this.handleChangeBound)
    const screenOrientation = window.screen?.orientation
    if (screenOrientation && typeof screenOrientation.removeEventListener === 'function') {
      screenOrientation.removeEventListener('change', this.handleChangeBound)
    }
  }

  addListener(handler: OrientationChangeHandler): () => void {
    this.listeners.add(handler)
    return () => {
      this.listeners.delete(handler)
    }
  }

  isLandscape(): boolean {
    if (typeof window === 'undefined') {
      return true
    }
    const screenOrientation = window.screen?.orientation
    if (screenOrientation?.type) {
      return screenOrientation.type.startsWith('landscape')
    }
    const legacyOrientation = readLegacyOrientation()
    if (legacyOrientation !== null) {
      return legacyOrientation === 90 || legacyOrientation === 270
    }
    return window.innerWidth >= window.innerHeight
  }

  getOrientationAngle(): number {
    if (typeof window === 'undefined') {
      return 0
    }
    const screenOrientation = window.screen?.orientation
    if (typeof screenOrientation?.angle === 'number') {
      return screenOrientation.angle
    }
    const legacyOrientation = readLegacyOrientation()
    if (legacyOrientation !== null) {
      return legacyOrientation
    }
    return window.innerWidth >= window.innerHeight ? 90 : 0
  }

  needsPermission(): boolean {
    return supportsPermissionRequest()
  }

  async requestPermission(): Promise<boolean> {
    if (!supportsPermissionRequest()) {
      return true
    }
    try {
      const response = await (DeviceOrientationEvent as typeof DeviceOrientationEvent & {
        requestPermission?: () => Promise<'granted' | 'denied'>
      }).requestPermission?.()
      return response === 'granted'
    } catch (error) {
      console.error('[OrientationManager] Permission request failed', error)
      return false
    }
  }
}
