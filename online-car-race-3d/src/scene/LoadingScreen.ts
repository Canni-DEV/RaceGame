import * as THREE from 'three'

const DEFAULT_TITLE = 'MICRO RACE'
const MIN_VISIBLE_MS = 900
const IDLE_ASSET_FALLBACK_MS = 700

export class LoadingScreen {
  private readonly root: HTMLDivElement
  private readonly statusEl: HTMLDivElement
  private readonly detailEl: HTMLDivElement
  private readonly progressFill: HTMLDivElement
  private readonly percentEl: HTMLDivElement
  private readonly startTime: number
  private assetsLoaded = 0
  private assetsTotal = 0
  private assetsReady = false
  private assetsActive = false
  private roomReady = false
  private stateReady = false
  private lastProgress = 0
  private isComplete = false
  private idleAssetTimeoutId: number | null = null
  private removalTimeoutId: number | null = null
  private boundManager: THREE.LoadingManager | null = null
  private previousOnStart?: THREE.LoadingManager['onStart']
  private previousOnProgress?: THREE.LoadingManager['onProgress']
  private previousOnLoad?: THREE.LoadingManager['onLoad']
  private previousOnError?: THREE.LoadingManager['onError']

  constructor(container: HTMLElement, title: string = DEFAULT_TITLE) {
    this.root = document.createElement('div')
    this.root.className = 'loading-screen'
    this.root.setAttribute('role', 'status')
    this.root.setAttribute('aria-live', 'polite')

    const content = document.createElement('div')
    content.className = 'loading-screen__content'
    this.root.appendChild(content)

    const titleEl = document.createElement('div')
    titleEl.className = 'loading-screen__title'
    titleEl.textContent = title
    content.appendChild(titleEl)

    this.statusEl = document.createElement('div')
    this.statusEl.className = 'loading-screen__status'
    content.appendChild(this.statusEl)

    const progress = document.createElement('div')
    progress.className = 'loading-screen__progress'
    content.appendChild(progress)

    const bar = document.createElement('div')
    bar.className = 'loading-screen__bar'
    progress.appendChild(bar)

    this.progressFill = document.createElement('div')
    this.progressFill.className = 'loading-screen__bar-fill'
    bar.appendChild(this.progressFill)

    const meta = document.createElement('div')
    meta.className = 'loading-screen__meta'
    progress.appendChild(meta)

    this.percentEl = document.createElement('div')
    this.percentEl.className = 'loading-screen__percent'
    meta.appendChild(this.percentEl)

    this.detailEl = document.createElement('div')
    this.detailEl.className = 'loading-screen__detail'
    meta.appendChild(this.detailEl)

    container.appendChild(this.root)
    this.startTime = performance.now()
    this.update()
  }

  bindLoadingManager(manager: THREE.LoadingManager = THREE.DefaultLoadingManager): void {
    if (this.boundManager === manager) {
      return
    }
    if (this.boundManager) {
      this.unbindLoadingManager()
    }
    this.boundManager = manager
    this.previousOnStart = manager.onStart
    this.previousOnProgress = manager.onProgress
    this.previousOnLoad = manager.onLoad
    this.previousOnError = manager.onError

    manager.onStart = (url: string, itemsLoaded: number, itemsTotal: number) => {
      this.previousOnStart?.(url, itemsLoaded, itemsTotal)
      this.handleAssetStart(itemsLoaded, itemsTotal)
    }
    manager.onProgress = (url: string, itemsLoaded: number, itemsTotal: number) => {
      this.previousOnProgress?.(url, itemsLoaded, itemsTotal)
      this.handleAssetProgress(itemsLoaded, itemsTotal)
    }
    manager.onLoad = () => {
      this.previousOnLoad?.()
      this.handleAssetLoad()
    }
    manager.onError = (url: string) => {
      this.previousOnError?.(url)
      this.handleAssetError(url)
    }
  }

  unbindLoadingManager(): void {
    if (!this.boundManager) {
      return
    }
    this.boundManager.onStart = this.previousOnStart
    this.boundManager.onProgress = this.previousOnProgress
    this.boundManager.onLoad = this.previousOnLoad
    this.boundManager.onError = this.previousOnError
    this.boundManager = null
    this.previousOnStart = undefined
    this.previousOnProgress = undefined
    this.previousOnLoad = undefined
    this.previousOnError = undefined
  }

  markRoomReady(): void {
    if (this.roomReady) {
      return
    }
    this.roomReady = true
    this.update()
    this.armIdleAssetFallback()
    this.maybeFinish()
  }

  markStateReady(): void {
    if (this.stateReady) {
      return
    }
    this.stateReady = true
    this.update()
  }

  private handleAssetStart(itemsLoaded: number, itemsTotal: number): void {
    this.assetsActive = true
    this.assetsReady = false
    this.assetsLoaded = itemsLoaded
    this.assetsTotal = Math.max(itemsTotal, this.assetsTotal)
    this.clearIdleAssetFallback()
    this.update()
  }

  private handleAssetProgress(itemsLoaded: number, itemsTotal: number): void {
    this.assetsActive = true
    this.assetsLoaded = itemsLoaded
    this.assetsTotal = Math.max(itemsTotal, this.assetsTotal)
    this.update()
  }

  private handleAssetLoad(): void {
    this.assetsReady = true
    this.assetsActive = false
    if (this.assetsTotal === 0) {
      this.assetsTotal = this.assetsLoaded
    }
    this.update()
    this.maybeFinish()
  }

  private handleAssetError(_url: string): void {
    this.update()
  }

  private armIdleAssetFallback(): void {
    if (this.assetsActive || this.assetsReady || this.assetsTotal > 0) {
      return
    }
    this.clearIdleAssetFallback()
    this.idleAssetTimeoutId = window.setTimeout(() => {
      if (this.assetsActive || this.assetsTotal > 0) {
        return
      }
      this.assetsReady = true
      this.update()
      this.maybeFinish()
    }, IDLE_ASSET_FALLBACK_MS)
  }

  private clearIdleAssetFallback(): void {
    if (this.idleAssetTimeoutId === null) {
      return
    }
    window.clearTimeout(this.idleAssetTimeoutId)
    this.idleAssetTimeoutId = null
  }

  private update(): void {
    const progress = this.calculateProgress()
    const percent = Math.round(progress * 100)
    this.percentEl.textContent = `${percent}%`
    this.progressFill.style.width = `${percent}%`

    if (!this.roomReady) {
      this.statusEl.textContent = 'Connecting to race server'
      this.detailEl.textContent = 'Waiting for room data'
      return
    }

    if (!this.assetsReady) {
      this.statusEl.textContent = this.assetsActive ? 'Loading track assets' : 'Preparing track'
      if (this.assetsTotal > 0) {
        this.detailEl.textContent = `Assets ${this.assetsLoaded}/${this.assetsTotal}`
      } else {
        this.detailEl.textContent = 'Staging assets'
      }
      return
    }

    this.statusEl.textContent = 'Ready on the grid'
    this.detailEl.textContent = 'Syncing players'
  }

  private calculateProgress(): number {
    const assetProgress =
      this.assetsReady
        ? 1
        : this.assetsTotal > 0
          ? this.assetsLoaded / this.assetsTotal
          : 0
    const roomProgress = this.roomReady ? 1 : 0
    const stateProgress = this.stateReady ? 1 : 0
    const weighted = assetProgress * 0.75 + roomProgress * 0.2 + stateProgress * 0.05
    const capped = this.isComplete ? 1 : Math.min(weighted, 0.98)
    if (capped > this.lastProgress) {
      this.lastProgress = capped
    }
    return this.lastProgress
  }

  private maybeFinish(): void {
    if (this.isComplete || !this.roomReady || !this.assetsReady) {
      return
    }
    this.isComplete = true
    const elapsed = performance.now() - this.startTime
    const delay = Math.max(0, MIN_VISIBLE_MS - elapsed)
    window.setTimeout(() => this.finish(), delay)
  }

  private finish(): void {
    if (!this.root.isConnected) {
      return
    }
    this.percentEl.textContent = '100%'
    this.progressFill.style.width = '100%'
    this.statusEl.textContent = 'Launching'
    this.detailEl.textContent = 'Enjoy the race'
    this.root.classList.add('loading-screen--complete')

    const handleTransition = (event: TransitionEvent): void => {
      if (event.propertyName !== 'opacity') {
        return
      }
      this.root.remove()
      this.root.removeEventListener('transitionend', handleTransition)
    }
    this.root.addEventListener('transitionend', handleTransition)

    this.removalTimeoutId = window.setTimeout(() => {
      if (this.root.isConnected) {
        this.root.remove()
      }
      if (this.removalTimeoutId !== null) {
        window.clearTimeout(this.removalTimeoutId)
        this.removalTimeoutId = null
      }
    }, 1300)
  }
}
