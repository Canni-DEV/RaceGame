import qrcode from 'qrcode-generator'
import type { GameStateStore, RoomInfoSnapshot } from '../state/GameStateStore'

const QR_CODE_SIZE = 160
const QR_MARGIN_CELLS = 2
const CONTROLLER_WINDOW_WIDTH = 300
const CONTROLLER_WINDOW_HEIGHT = 100
const CONTROLLER_WINDOW_BOTTOM_MARGIN = 16
const CONTROLLER_WINDOW_NAME = 'controllerWindow'
const CONTROLLER_VIEW_PARAM = 'controllerView'
const CONTROLLER_VIEW_COMPACT = 'compact'

export class ViewerControllerAccess {
  private readonly root: HTMLElement
  private readonly qrCanvas: HTMLCanvasElement
  private readonly statusText: HTMLElement
  private readonly roomValue: HTMLElement
  private readonly playerValue: HTMLElement
  private readonly linkMessage: HTMLElement
  private readonly linkElement: HTMLAnchorElement
  private readonly serverParam: string | null
  private isReady = false
  private userHidden = false
  private readonly unsubscribeRoomInfo: () => void

  constructor(container: HTMLElement, store: GameStateStore) {
    this.serverParam = this.resolveServerParam()

    this.root = document.createElement('div')
    this.root.className = 'viewer-controller-access ui-panel'
    this.root.hidden = true

    const header = document.createElement('div')
    header.className = 'viewer-controller-access__header'

    const headerIcon = document.createElement('span')
    headerIcon.className = 'ui-icon ui-icon--cone'
    header.appendChild(headerIcon)

    const title = document.createElement('div')
    title.className = 'viewer-controller-access__title'
    title.textContent = 'Join on your phone!'
    header.appendChild(title)
    this.root.appendChild(header)

    const body = document.createElement('div')
    body.className = 'viewer-controller-access__body'

    this.qrCanvas = document.createElement('canvas')
    this.qrCanvas.className = 'viewer-controller-access__qr'
    this.qrCanvas.width = 0
    this.qrCanvas.height = 0
    this.qrCanvas.setAttribute('aria-hidden', 'true')
    const qrWrap = document.createElement('div')
    qrWrap.className = 'viewer-controller-access__qr-wrap'
    qrWrap.appendChild(this.qrCanvas)
    body.appendChild(qrWrap)

    const info = document.createElement('div')
    info.className = 'viewer-controller-access__info'

    this.statusText = document.createElement('div')
    this.statusText.className = 'viewer-controller-access__status'
    this.statusText.textContent = 'Scan the QR code to join!'
    info.appendChild(this.statusText)

    const meta = document.createElement('div')
    meta.className = 'viewer-controller-access__meta'

    const roomRow = this.createMetaRow('Room code')
    this.roomValue = roomRow.value
    meta.appendChild(roomRow.root)

    const playerRow = this.createMetaRow('Player name')
    this.playerValue = playerRow.value
    meta.appendChild(playerRow.root)
    info.appendChild(meta)

    this.linkMessage = document.createElement('div')
    this.linkMessage.className = 'viewer-controller-access__helper'

    const linkPrefix = document.createElement('span')
    linkPrefix.textContent = 'If you have trouble connecting, open '
    this.linkElement = document.createElement('a')
    this.linkElement.target = '_blank'
    this.linkElement.rel = 'noopener noreferrer'
    this.linkElement.textContent = 'this link'
    const linkSuffix = document.createElement('span')
    linkSuffix.textContent = ' on your phone.'
    this.linkMessage.appendChild(linkPrefix)
    this.linkMessage.appendChild(this.linkElement)
    this.linkMessage.appendChild(linkSuffix)
    this.linkElement.addEventListener('click', this.handleLinkClick)
    info.appendChild(this.linkMessage)

    body.appendChild(info)
    this.root.appendChild(body)

    const checkered = document.createElement('div')
    checkered.className = 'viewer-controller-access__checkered'
    this.root.appendChild(checkered)

    container.appendChild(this.root)

    this.unsubscribeRoomInfo = store.onRoomInfo((info) => {
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
    const controllerUrl = this.buildControllerUrl(
      info.roomId,
      info.playerId,
      info.sessionToken ?? undefined,
    )
    this.roomValue.textContent = info.roomId
    this.playerValue.textContent = info.playerId
    this.linkElement.href = controllerUrl
    this.renderQrCode(controllerUrl)
    this.updateVisibility()
  }

  private resolveServerParam(): string | null {
    const params = new URLSearchParams(window.location.search)
    return params.get('server') ?? params.get('serverUrl')
  }

  private buildControllerUrl(roomId: string, playerId: string, sessionToken?: string): string {
    const url = new URL(window.location.href)
    url.searchParams.set('mode', 'controller')
    url.searchParams.set('roomId', roomId)
    url.searchParams.set('playerId', playerId)
    if (sessionToken) {
      url.searchParams.set('sessionToken', sessionToken)
    } else {
      url.searchParams.delete('sessionToken')
    }
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

  private createMetaRow(label: string): { root: HTMLElement; value: HTMLElement } {
    const row = document.createElement('div')
    row.className = 'viewer-controller-access__meta-row'

    const labelEl = document.createElement('span')
    labelEl.className = 'viewer-controller-access__meta-label'
    labelEl.textContent = label

    const valueEl = document.createElement('span')
    valueEl.className = 'viewer-controller-access__meta-value'

    row.appendChild(labelEl)
    row.appendChild(valueEl)
    return { root: row, value: valueEl }
  }

  private readonly handleLinkClick = (event: MouseEvent): void => {
    if (!this.linkElement.href) {
      return
    }

    const width = CONTROLLER_WINDOW_WIDTH
    const height = CONTROLLER_WINDOW_HEIGHT
    const windowLeft = window.screenX ?? 0
    const windowTop = window.screenY ?? 0
    const outerWidth = window.outerWidth || window.innerWidth || width
    const outerHeight = window.outerHeight || window.innerHeight || height
    const left = Math.max(0, Math.round(windowLeft + (outerWidth - width) / 2))
    const top = Math.max(
      0,
      Math.round(windowTop + outerHeight - height - CONTROLLER_WINDOW_BOTTOM_MARGIN),
    )
    const popupUrl = new URL(this.linkElement.href)
    popupUrl.searchParams.set(CONTROLLER_VIEW_PARAM, CONTROLLER_VIEW_COMPACT)
    const features = [
      'popup=yes',
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
      'resizable=yes',
      'scrollbars=yes',
      'noopener=yes',
    ].join(',')
    const opened = window.open(popupUrl.toString(), CONTROLLER_WINDOW_NAME, features)
    if (opened) {
      event.preventDefault()
      opened.focus()
    }
  }

  dispose(): void {
    this.unsubscribeRoomInfo()
    this.root.remove()
  }
}
