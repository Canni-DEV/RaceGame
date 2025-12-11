import qrcode from 'qrcode-generator'
import type { GameStateStore, RoomInfoSnapshot } from '../state/GameStateStore'

const QR_CODE_SIZE = 160
const QR_MARGIN_CELLS = 2

export class ViewerControllerAccess {
  private readonly root: HTMLElement
  private readonly qrCanvas: HTMLCanvasElement
  private readonly statusText: HTMLElement
  private readonly linkElement: HTMLAnchorElement
  private readonly serverParam: string | null
  private isReady = false
  private userHidden = false

  constructor(container: HTMLElement, store: GameStateStore) {
    this.serverParam = this.resolveServerParam()

    this.root = document.createElement('div')
    this.root.className = 'viewer-controller-access'
    this.root.hidden = true

    const title = document.createElement('div')
    title.className = 'viewer-controller-access__title'
    title.textContent = 'Controller'
    this.root.appendChild(title)

    this.qrCanvas = document.createElement('canvas')
    this.qrCanvas.className = 'viewer-controller-access__qr'
    this.qrCanvas.width = 0
    this.qrCanvas.height = 0
    this.qrCanvas.setAttribute('aria-hidden', 'true')
    this.root.appendChild(this.qrCanvas)

    this.statusText = document.createElement('div')
    this.statusText.className = 'viewer-controller-access__status'
    this.root.appendChild(this.statusText)

    this.linkElement = document.createElement('a')
    this.linkElement.className = 'viewer-controller-access__link'
    this.linkElement.target = '_blank'
    this.linkElement.rel = 'noopener noreferrer'
    this.root.appendChild(this.linkElement)

    container.appendChild(this.root)

    store.onRoomInfo((info) => {
      this.handleRoomInfo(info)
    })
  }

  toggleVisibility(): void {
    if (!this.isReady) {
      return
    }
    this.userHidden = !this.userHidden
    this.updateVisibility()
  }

  hide(): void {
    this.userHidden = true
    this.updateVisibility()
  }

  private handleRoomInfo(info: RoomInfoSnapshot): void {
    if (!info.roomId || !info.playerId) {
      this.isReady = false
      this.updateVisibility()
      return
    }

    this.isReady = true
    const controllerUrl = this.buildControllerUrl(info.roomId, info.playerId)
    this.statusText.textContent = `Room ${info.roomId} · Player ${info.playerId}`
    this.linkElement.href = controllerUrl
    this.linkElement.textContent = controllerUrl
    this.renderQrCode(controllerUrl)
    this.updateVisibility()
  }

  private resolveServerParam(): string | null {
    const params = new URLSearchParams(window.location.search)
    return params.get('server') ?? params.get('serverUrl')
  }

  private buildControllerUrl(roomId: string, playerId: string): string {
    const url = new URL(window.location.href)
    url.searchParams.set('mode', 'controller')
    url.searchParams.set('roomId', roomId)
    url.searchParams.set('playerId', playerId)
    if (this.serverParam) {
      url.searchParams.set('server', this.serverParam)
    } else {
      url.searchParams.delete('server')
      url.searchParams.delete('serverUrl')
    }
    return url.toString()
  }

  private renderQrCode(data: string): void {
    const qr = qrcode(0, 'M')
    qr.addData(data)
    qr.make()

    const modules = qr.getModuleCount()
    const scale = Math.max(2, Math.floor(QR_CODE_SIZE / modules))
    const margin = QR_MARGIN_CELLS * scale
    const size = modules * scale + margin * 2

    this.qrCanvas.width = size
    this.qrCanvas.height = size
    const context = this.qrCanvas.getContext('2d')
    if (!context) {
      return
    }
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, size, size)
    context.fillStyle = '#111111'

    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) {
        if (qr.isDark(row, col)) {
          const x = col * scale + margin
          const y = row * scale + margin
          context.fillRect(x, y, scale, scale)
        }
      }
    }
  }

  private updateVisibility(): void {
    this.root.hidden = !this.isReady || this.userHidden
  }
}
