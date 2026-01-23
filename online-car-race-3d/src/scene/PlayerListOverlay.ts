import type { GameStateStore } from '../state/GameStateStore'
import type { PlayerSummary } from '../net/messages'
import type { RoomState } from '../core/trackTypes'
import { hashPlayerIdToHue } from '../core/playerColor'

interface PlayerListOverlayOptions {
  onSelectPlayer?: (playerId: string) => void
}

interface PlayerListRow {
  root: HTMLElement
  avatar: HTMLElement
  name: HTMLElement
  badges: HTMLElement
  stats: HTMLElement
}

export class PlayerListOverlay {
  private readonly root: HTMLElement
  private readonly list: HTMLElement
  private readonly playerSpeeds: Map<string, number>
  private readonly turboCharges: Map<string, number>
  private readonly missileCharges: Map<string, number>
  private readonly activePlayers: Map<string, PlayerSummary>
  private readonly readyPlayers: Set<string>
  private readonly rows: Map<string, PlayerListRow>
  private readonly playerLookup: Map<string, PlayerSummary>
  private readonly onSelectPlayer?: (playerId: string) => void
  private readonly unsubscribeRoomInfo: () => void
  private readonly unsubscribeState: () => void
  private players: PlayerSummary[] = []
  private leaderId: string | null = null
  private racePhase: RoomState['race']['phase'] | null = null
  private userHidden = false
  private isReady = false
  private localPlayerId: string | null = null
  private localHasCar = false

  constructor(container: HTMLElement, store: GameStateStore, options?: PlayerListOverlayOptions) {
    this.playerSpeeds = new Map()
    this.turboCharges = new Map()
    this.missileCharges = new Map()
    this.activePlayers = new Map()
    this.readyPlayers = new Set()
    this.rows = new Map()
    this.playerLookup = new Map()
    this.onSelectPlayer = options?.onSelectPlayer

    this.root = document.createElement('div')
    this.root.className = 'player-list-overlay ui-panel'
    this.root.hidden = true

    const header = document.createElement('div')
    header.className = 'player-list-overlay__header'

    const headerIcon = document.createElement('span')
    headerIcon.className = 'ui-icon ui-icon--shield'
    header.appendChild(headerIcon)

    const title = document.createElement('div')
    title.className = 'player-list-overlay__title'
    title.textContent = 'Connected players'
    header.appendChild(title)
    this.root.appendChild(header)

    this.list = document.createElement('div')
    this.list.className = 'player-list-overlay__list'
    this.root.appendChild(this.list)

    container.appendChild(this.root)

    this.unsubscribeRoomInfo = store.onRoomInfo((info) => {
      this.players = info.players
      this.localPlayerId = info.playerId
      this.updateReadiness()
      this.render()
    })

    this.unsubscribeState = store.onState((state) => {
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
    this.activePlayers.clear()
    this.readyPlayers.clear()
    this.localHasCar = false
    this.racePhase = state.race.phase

    for (const car of state.cars) {
      this.playerSpeeds.set(car.playerId, Math.abs(car.speed))
      this.turboCharges.set(car.playerId, car.turboCharges ?? 0)
      this.missileCharges.set(car.playerId, car.missileCharges ?? 0)
      this.activePlayers.set(car.playerId, {
        playerId: car.playerId,
        username: car.username ?? car.playerId,
        isNpc: car.isNpc,
      })
      if (car.playerId === this.localPlayerId) {
        this.localHasCar = true
      }
    }

    for (const entry of state.race.players) {
      if (!entry.isNpc && entry.ready) {
        this.readyPlayers.add(entry.playerId)
      }
    }
    const leaderEntry = state.race.leaderboard.find((entry) => entry.position === 1)
    this.leaderId = leaderEntry?.playerId ?? null

    this.updateReadiness()
    this.render()
  }

  private render(): void {
    const displayPlayers = this.getDisplayPlayers()
    if (displayPlayers.length === 0) {
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
    for (const player of displayPlayers) {
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
    root.addEventListener('keydown', this.handleRowKeyPress)

    const avatar = document.createElement('span')
    avatar.className = 'player-list-overlay__avatar'

    const avatarIcon = document.createElement('span')
    avatarIcon.className = 'player-list-overlay__avatar-icon ui-icon ui-icon--helmet'
    avatar.appendChild(avatarIcon)
    root.appendChild(avatar)

    const content = document.createElement('div')
    content.className = 'player-list-overlay__body'

    const nameRow = document.createElement('div')
    nameRow.className = 'player-list-overlay__name-row'

    const name = document.createElement('div')
    name.className = 'player-list-overlay__name'
    nameRow.appendChild(name)

    const badges = document.createElement('div')
    badges.className = 'player-list-overlay__badges'
    nameRow.appendChild(badges)

    content.appendChild(nameRow)

    const stats = document.createElement('div')
    stats.className = 'player-list-overlay__stats'
    content.appendChild(stats)

    root.appendChild(content)

    const row: PlayerListRow = { root, avatar, name, badges, stats }
    this.rows.set(player.playerId, row)
    return row
  }

  private updateRow(row: PlayerListRow, player: PlayerSummary): void {
    row.root.dataset.playerId = player.playerId
    const isActive = this.activePlayers.has(player.playerId)
    row.avatar.style.background = isActive ? this.getColor(player) : 'rgba(255, 255, 255, 0.08)'
    const isLeader = player.playerId === this.leaderId
    row.root.classList.toggle('is-leader', isLeader)
    row.root.classList.toggle('is-npc', Boolean(player.isNpc))

    const displayName = this.getDisplayName(player)
    row.name.textContent = displayName

    row.badges.textContent = ''
    const addBadge = (label: string, variant?: string, icon?: string): void => {
      const badge = document.createElement('span')
      badge.className = `player-list-overlay__badge${variant ? ` player-list-overlay__badge--${variant}` : ''}`
      if (icon) {
        const iconEl = document.createElement('span')
        iconEl.className = `ui-icon ui-icon--${icon} player-list-overlay__badge-icon`
        badge.appendChild(iconEl)
      }
      badge.appendChild(document.createTextNode(label))
      row.badges.appendChild(badge)
    }

    if (isLeader) {
      addBadge('Leader', 'leader', 'trophy')
    }
    if (player.isNpc) {
      addBadge('NPC', 'npc')
    }
    addBadge(isActive ? 'On track' : 'Lobby', isActive ? 'active' : 'idle')
    if (this.racePhase === 'lobby' && !player.isNpc) {
      const ready = this.readyPlayers.has(player.playerId)
      addBadge(ready ? 'Ready' : 'Pending', ready ? 'ready' : 'pending')
    }

    row.stats.textContent = ''
    if (isActive) {
      const speedValue = this.playerSpeeds.get(player.playerId)
      const turbo = this.turboCharges.get(player.playerId) ?? 0
      const missiles = this.missileCharges.get(player.playerId) ?? 0
      if (speedValue !== undefined) {
        row.stats.appendChild(this.createStat('SPD', `${speedValue.toFixed(1)}u`))
      }
      row.stats.appendChild(this.createStat('Turbo', turbo.toString()))
      row.stats.appendChild(this.createStat('Miss', missiles.toString()))
    }
    row.stats.hidden = row.stats.childElementCount === 0

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
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Space') {
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

  private updateReadiness(): void {
    this.isReady = this.players.length > 0 || this.activePlayers.size > 0
  }

  private getDisplayPlayers(): PlayerSummary[] {
    const merged = new Map<string, PlayerSummary>()

    for (const player of this.players) {
      merged.set(player.playerId, player)
    }

    for (const player of this.activePlayers.values()) {
      const existing = merged.get(player.playerId)
      if (existing) {
        merged.set(player.playerId, { ...existing, ...player })
      } else {
        merged.set(player.playerId, player)
      }
    }

    return Array.from(merged.values())
  }

  private getColor(player: PlayerSummary): string {
    if (player.isNpc) {
      return '#ffa133'
    }
    const hue = hashPlayerIdToHue(player.playerId) * 360
    return `hsl(${hue.toFixed(0)}deg 65% 50%)`
  }

  private canSelectTarget(player: PlayerSummary): boolean {
    return (
      Boolean(this.onSelectPlayer) &&
      !!this.localPlayerId &&
      !this.localHasCar &&
      !player.isNpc &&
      this.activePlayers.has(player.playerId)
    )
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

  private createStat(label: string, value: string): HTMLElement {
    const stat = document.createElement('span')
    stat.className = 'player-list-overlay__stat'
    stat.textContent = `${label} ${value}`
    return stat
  }

  dispose(): void {
    this.unsubscribeRoomInfo()
    this.unsubscribeState()
    this.clearRows()
    this.root.remove()
  }
}
