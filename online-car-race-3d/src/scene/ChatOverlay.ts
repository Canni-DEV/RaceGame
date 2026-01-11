import type { ChatMessage } from '../net/messages'
import type { SocketClient } from '../net/SocketClient'
import type { GameStateStore, RoomInfoSnapshot } from '../state/GameStateStore'
import {
  CHAT_MAX_MESSAGE_LENGTH,
  CHAT_MAX_MESSAGES,
  CHAT_MESSAGE_TTL_MS,
  CHAT_SEND_COOLDOWN_MS,
} from '../config'

type ChatOverlayOptions = {
  messageTtlMs?: number
  maxMessages?: number
  maxMessageLength?: number
  sendCooldownMs?: number
}

type ChatEntry = {
  id: number
  payload: ChatMessage
  receivedAt: number
  expiresAt: number
}

const SYSTEM_LABEL = 'System'
const PRUNE_INTERVAL_MS = 1000

export class ChatOverlay {
  private readonly root: HTMLElement
  private readonly messageList: HTMLElement
  private readonly inputRow: HTMLElement
  private readonly inputLabel: HTMLElement
  private readonly input: HTMLInputElement
  private readonly entries: ChatEntry[] = []
  private readonly maxMessages: number
  private readonly maxMessageLength: number
  private readonly messageTtlMs: number
  private readonly sendCooldownMs: number
  private readonly socketClient: SocketClient
  private inputActive = false
  private lastSendAt = 0
  private pruneTimerId: number | null = null
  private nextMessageId = 1
  private roomId: string | null = null
  private readonly unsubscribeRoomInfo: () => void
  private readonly unsubscribeChat: () => void

  constructor(
    container: HTMLElement,
    store: GameStateStore,
    socketClient: SocketClient,
    options?: ChatOverlayOptions,
  ) {
    this.socketClient = socketClient
    this.messageTtlMs = Math.max(1000, options?.messageTtlMs ?? CHAT_MESSAGE_TTL_MS)
    this.maxMessages = Math.max(1, Math.round(options?.maxMessages ?? CHAT_MAX_MESSAGES))
    this.maxMessageLength = Math.max(1, Math.round(options?.maxMessageLength ?? CHAT_MAX_MESSAGE_LENGTH))
    this.sendCooldownMs = Math.max(0, Math.round(options?.sendCooldownMs ?? CHAT_SEND_COOLDOWN_MS))

    this.root = document.createElement('div')
    this.root.className = 'chat-overlay'
    this.root.hidden = true

    this.messageList = document.createElement('div')
    this.messageList.className = 'chat-overlay__messages'
    this.root.appendChild(this.messageList)

    this.inputRow = document.createElement('div')
    this.inputRow.className = 'chat-overlay__input-row'
    this.inputRow.hidden = true
    this.root.appendChild(this.inputRow)

    this.inputLabel = document.createElement('span')
    this.inputLabel.className = 'chat-overlay__input-label'
    this.inputLabel.textContent = 'Say:'
    this.inputRow.appendChild(this.inputLabel)

    this.input = document.createElement('input')
    this.input.className = 'chat-overlay__input'
    this.input.type = 'text'
    this.input.autocomplete = 'off'
    this.input.autocapitalize = 'off'
    this.input.autocorrect = false
    this.input.spellcheck = false
    this.input.maxLength = this.maxMessageLength
    this.input.hidden = true
    this.input.setAttribute('aria-label', 'Chat message')
    this.inputRow.appendChild(this.input)

    container.appendChild(this.root)

    this.unsubscribeRoomInfo = store.onRoomInfo((info: RoomInfoSnapshot) => {
      this.roomId = info.roomId
    })

    this.unsubscribeChat = socketClient.onChatMessage((message) => {
      this.handleChatMessage(message)
    })

    window.addEventListener('keydown', this.handleGlobalKeyDown)
    this.input.addEventListener('keydown', this.handleInputKeyDown)
    this.input.addEventListener('blur', this.handleInputBlur)
  }

  private readonly handleGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || event.key !== 'Enter') {
      return
    }
    if (this.inputActive) {
      return
    }

    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    this.activateInput()
  }

  private readonly handleInputKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation()
    if (event.isComposing) {
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      this.deactivateInput()
      return
    }
    if (event.key !== 'Enter') {
      return
    }
    event.preventDefault()
    this.submitMessage()
  }

  private readonly handleInputBlur = (): void => {
    if (!this.inputActive) {
      return
    }
    this.deactivateInput()
  }

  private handleChatMessage(message: ChatMessage): void {
    if (this.roomId && message.roomId && message.roomId !== this.roomId) {
      return
    }

    const normalized = this.normalizeMessage(message.message)
    if (!normalized) {
      return
    }

    const now = Date.now()
    const entry: ChatEntry = {
      id: this.nextMessageId++,
      payload: { ...message, message: normalized },
      receivedAt: now,
      expiresAt: now + this.messageTtlMs,
    }
    this.entries.push(entry)
    if (this.entries.length > this.maxMessages) {
      this.entries.splice(0, this.entries.length - this.maxMessages)
    }

    this.renderMessages()
    this.ensurePruneTimer()
    this.updateVisibility()
  }

  private activateInput(): void {
    this.inputActive = true
    this.inputRow.hidden = false
    this.input.hidden = false
    this.updateVisibility()
    window.requestAnimationFrame(() => {
      if (!this.inputActive) {
        return
      }
      this.input.focus({ preventScroll: true })
      const cursor = this.input.value.length
      this.input.setSelectionRange(cursor, cursor)
    })
  }

  private deactivateInput(): void {
    this.inputActive = false
    this.inputRow.hidden = true
    this.input.hidden = true
    this.input.value = ''
    this.input.blur()
    this.updateVisibility()
  }

  private submitMessage(): void {
    const normalized = this.normalizeMessage(this.input.value)
    if (!normalized) {
      return
    }
    if (!this.socketClient.isConnected()) {
      return
    }

    const now = Date.now()
    if (this.sendCooldownMs > 0 && now - this.lastSendAt < this.sendCooldownMs) {
      return
    }

    this.socketClient.sendChatMessage({
      roomId: this.roomId ?? undefined,
      message: normalized,
    })
    this.input.value = ''
    this.lastSendAt = now
  }

  private normalizeMessage(raw: string): string {
    if (!raw) {
      return ''
    }
    const trimmed = raw.replace(/[\r\n\t]+/g, ' ').trim()
    if (!trimmed) {
      return ''
    }
    if (trimmed.length <= this.maxMessageLength) {
      return trimmed
    }
    return trimmed.slice(0, this.maxMessageLength).trimEnd()
  }

  private renderMessages(): void {
    this.messageList.replaceChildren()
    for (const entry of this.entries) {
      const row = document.createElement('div')
      row.className = 'chat-overlay__message'
      row.textContent = this.formatMessage(entry.payload)
      this.messageList.appendChild(row)
    }
  }

  private formatMessage(message: ChatMessage): string {
    const sender = message.isSystem
      ? SYSTEM_LABEL
      : message.username || message.playerId || 'Unknown'
    return `${sender}: ${message.message}`
  }

  private ensurePruneTimer(): void {
    if (this.pruneTimerId !== null) {
      return
    }
    this.pruneTimerId = window.setInterval(() => {
      this.pruneExpired()
    }, PRUNE_INTERVAL_MS)
  }

  private pruneExpired(): void {
    if (this.entries.length === 0) {
      this.clearPruneTimer()
      return
    }

    const now = Date.now()
    const filtered = this.entries.filter((entry) => entry.expiresAt > now)
    if (filtered.length === this.entries.length) {
      return
    }
    this.entries.length = 0
    this.entries.push(...filtered)
    if (this.entries.length === 0) {
      this.clearPruneTimer()
    }
    this.renderMessages()
    this.updateVisibility()
  }

  private clearPruneTimer(): void {
    if (this.pruneTimerId === null) {
      return
    }
    window.clearInterval(this.pruneTimerId)
    this.pruneTimerId = null
  }

  private updateVisibility(): void {
    const hasMessages = this.entries.length > 0
    this.messageList.hidden = !hasMessages
    this.inputRow.hidden = !this.inputActive
    this.root.hidden = !hasMessages && !this.inputActive
    this.root.style.pointerEvents = this.inputActive ? 'auto' : 'none'
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleGlobalKeyDown)
    this.input.removeEventListener('keydown', this.handleInputKeyDown)
    this.input.removeEventListener('blur', this.handleInputBlur)
    this.unsubscribeRoomInfo()
    this.unsubscribeChat()
    this.clearPruneTimer()
    this.entries.length = 0
    this.root.remove()
  }
}
