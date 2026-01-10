import type { GameStateStore } from '../state/GameStateStore'
import type { PlayerSummary } from '../net/messages'
import type { RoomState } from '../core/trackTypes'

interface PlayerListOverlayOptions {
  onSelectPlayer?: (playerId: string) => void
}

interface PlayerListRow {
  root: HTMLElement
  badge: HTMLElement
  name: HTMLElement
  status: HTMLElement
}

export class PlayerListOverlay {
  private readonly root: HTMLElement
  private readonly list: HTMLElement
  private readonly playerSpeeds: Map<string, number>
  private readonly turboCharges: Map<string, number>
  private readonly missileCharges: Map<string, number>
  private readonly rows: Map<string, PlayerListRow>
  private readonly playerLookup: Map<string, PlayerSummary>
  private readonly onSelectPlayer?: (playerId: string) => void
  private players: PlayerSummary[] = []
  private userHidden = false
  private isReady = false
  private localPlayerId: string | null = null
  private localHasCar = false

  constructor(container: HTMLElement, store: GameStateStore, options?: PlayerListOverlayOptions) {
    this.playerSpeeds = new Map()
    this.turboCharges = new Map()
    this.missileCharges = new Map()
    this.rows = new Map()
    this.playerLookup = new Map()
    this.onSelectPlayer = options?.onSelectPlayer

    this.root = document.createElement('div')
    this.root.className = 'player-list-overlay'
    this.root.hidden = true

    const title = document.createElement('div')
    title.className = 'player-list-overlay__title'
    title.textContent = 'Connected players'
    this.root.appendChild(title)

    this.list = document.createElement('div')
    this.list.className = 'player-list-overlay__list'
    this.root.appendChild(this.list)

    container.appendChild(this.root)

    store.onRoomInfo((info) => {
      this.players = info.players
      this.localPlayerId = info.playerId
      this.isReady = this.players.length > 0
      this.render()
    })

    store.onState((state) => {
      this.handleState(state)
    })
  }

  toggleVisibility(): void {
    if (!this.isReady) {
      return
    }
    this.userHidden = !this.userHidden
    this.updateVisibility()
  }

  private handleState(state: RoomState): void {
    this.playerSpeeds.clear()
    this.turboCharges.clear()
    this.missileCharges.clear()
    this.localHasCar = false
    const playersInRace: PlayerSummary[] = []

    for (const car of state.cars) {
      this.playerSpeeds.set(car.playerId, Math.abs(car.speed))
      this.turboCharges.set(car.playerId, car.turboCharges ?? 0)
      this.missileCharges.set(car.playerId, car.missileCharges ?? 0)
      playersInRace.push({
        playerId: car.playerId,
        username: car.username ?? car.playerId,
        isNpc: car.isNpc,
      })
      if (car.playerId === this.localPlayerId) {
        this.localHasCar = true
      }
    }

    this.players = playersInRace
    this.isReady = this.players.length > 0
    this.render()
  }

  private render(): void {
    if (this.players.length === 0) {
      this.clearRows()
      const empty = document.createElement('div')
      empty.className = 'player-list-overlay__empty'
      empty.textContent = 'Waiting for players...'
      this.list.appendChild(empty)
      this.isReady = false
      this.updateVisibility()
      return
    }

    this.playerLookup.clear()

    if (this.rows.size === 0) {
      this.list.textContent = ''
    }

    const activeIds = new Set<string>()
    for (const player of this.players) {
      this.playerLookup.set(player.playerId, player)
      const row = this.getOrCreateRow(player)
      this.updateRow(row, player)
      activeIds.add(player.playerId)
      if (!this.list.contains(row.root)) {
        this.list.appendChild(row.root)
      }
    }

    for (const [playerId, row] of this.rows.entries()) {
      if (!activeIds.has(playerId)) {
        row.root.remove()
        this.rows.delete(playerId)
        this.playerLookup.delete(playerId)
      }
    }

    this.isReady = true
    this.updateVisibility()
  }

  private getOrCreateRow(player: PlayerSummary): PlayerListRow {
    const existing = this.rows.get(player.playerId)
    if (existing) {
      return existing
    }

    const root = document.createElement('div')
    root.className = 'player-list-overlay__item'
    root.dataset.playerId = player.playerId
    root.tabIndex = -1
    root.addEventListener('click', this.handleRowClick)
    root.addEventListener('keypress', this.handleRowKeyPress)

    const badge = document.createElement('span')
    badge.className = 'player-list-overlay__color'
    root.appendChild(badge)

    const content = document.createElement('div')
    content.className = 'player-list-overlay__content'

    const name = document.createElement('div')
    name.className = 'player-list-overlay__name'
    content.appendChild(name)

    const status = document.createElement('div')
    status.className = 'player-list-overlay__speed'
    content.appendChild(status)

    root.appendChild(content)

    const row: PlayerListRow = { root, badge, name, status }
    this.rows.set(player.playerId, row)
    return row
  }

  private updateRow(row: PlayerListRow, player: PlayerSummary): void {
    row.root.dataset.playerId = player.playerId
    row.badge.style.background = this.getColor(player)

    const displayName = this.getDisplayName(player)
    row.name.textContent = player.isNpc ? `${displayName} · NPC` : displayName

    const speedValue = this.playerSpeeds.get(player.playerId)
    const turbo = this.turboCharges.get(player.playerId) ?? 0
    const missiles = this.missileCharges.get(player.playerId) ?? 0
    const speedText = speedValue === undefined ? 'no data' : `${speedValue.toFixed(1)}u`
    row.status.textContent = `${speedText} · ⚡${turbo} · 🎯${missiles}`

    const selectable = this.canSelectTarget(player)
    row.root.classList.toggle('is-selectable', selectable)
    row.root.tabIndex = selectable ? 0 : -1
  }

  private clearRows(): void {
    for (const row of this.rows.values()) {
      row.root.remove()
    }
    this.rows.clear()
    this.playerLookup.clear()
    this.list.textContent = ''
  }

  private readonly handleRowClick = (event: Event): void => {
    this.handleRowSelect(event)
  }

  private readonly handleRowKeyPress = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }
    event.preventDefault()
    this.handleRowSelect(event)
  }

  private handleRowSelect(event: Event): void {
    const target = event.currentTarget as HTMLElement | null
    const playerId = target?.dataset.playerId
    if (playerId) {
      this.handleSelect(playerId)
    }
  }

  private updateVisibility(): void {
    this.root.hidden = !this.isReady || this.userHidden
  }

  private getColor(player: PlayerSummary): string {
    if (player.isNpc) {
      return '#ffa133'
    }
    let hash = 0
    for (let i = 0; i < player.playerId.length; i++) {
      hash = (hash * 31 + player.playerId.charCodeAt(i)) | 0
    }
    const normalized = (hash & 0xffff) / 0xffff
    const hue = ((normalized + 1) % 1) * 360
    return `hsl(${hue.toFixed(0)}deg 65% 50%)`
  }

  private canSelectTarget(player: PlayerSummary): boolean {
    return Boolean(this.onSelectPlayer) && !!this.localPlayerId && !this.localHasCar && !player.isNpc
  }

  private handleSelect(playerId: string): void {
    if (!this.onSelectPlayer) {
      return
    }
    const player = this.playerLookup.get(playerId)
    if (!player || !this.canSelectTarget(player)) {
      return
    }
    this.onSelectPlayer(playerId)
  }

  private getDisplayName(player: PlayerSummary): string {
    return player.username || player.playerId
  }
}
