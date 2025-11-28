import type { GameStateStore } from '../state/GameStateStore'
import type { PlayerSummary } from '../net/messages'
import type { RoomState } from '../core/trackTypes'

interface PlayerListOverlayOptions {
  onSelectPlayer?: (playerId: string) => void
}

export class PlayerListOverlay {
  private readonly root: HTMLElement
  private readonly list: HTMLElement
  private readonly playerSpeeds: Map<string, number>
  private readonly turboCharges: Map<string, number>
  private readonly missileCharges: Map<string, number>
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
    this.onSelectPlayer = options?.onSelectPlayer

    this.root = document.createElement('div')
    this.root.className = 'player-list-overlay'
    this.root.hidden = true

    const title = document.createElement('div')
    title.className = 'player-list-overlay__title'
    title.textContent = 'Players conectados'
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
      playersInRace.push({ playerId: car.playerId, isNpc: car.isNpc })
      if (car.playerId === this.localPlayerId) {
        this.localHasCar = true
      }
    }

    this.players = playersInRace
    this.isReady = this.players.length > 0
    this.render()
  }

  private render(): void {
    this.list.replaceChildren()
    if (this.players.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'player-list-overlay__empty'
      empty.textContent = 'Esperando jugadores...'
      this.list.appendChild(empty)
      this.isReady = false
      this.updateVisibility()
      return
    }

    for (const player of this.players) {
      const entry = document.createElement('div')
      entry.className = 'player-list-overlay__item'
      if (this.canSelectTarget(player)) {
        entry.classList.add('is-selectable')
        entry.tabIndex = 0
        entry.addEventListener('click', () => this.handleSelect(player.playerId))
        entry.addEventListener('keypress', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            this.handleSelect(player.playerId)
          }
        })
      }

      const badge = document.createElement('span')
      badge.className = 'player-list-overlay__color'
      badge.style.background = this.getColor(player)
      entry.appendChild(badge)

      const content = document.createElement('div')
      content.className = 'player-list-overlay__content'

      const name = document.createElement('div')
      name.className = 'player-list-overlay__name'
      name.textContent = player.isNpc ? `${player.playerId} · NPC` : player.playerId
      content.appendChild(name)

      const speedValue = this.playerSpeeds.get(player.playerId)
      const status = document.createElement('div')
      status.className = 'player-list-overlay__speed'
      const turbo = this.turboCharges.get(player.playerId) ?? 0
      const missiles = this.missileCharges.get(player.playerId) ?? 0
      const speedText =
        speedValue === undefined ? 'sin datos' : `${speedValue.toFixed(1)}u`
      status.textContent = `${speedText} · ⚡${turbo} · 🎯${missiles}`
      content.appendChild(status)

      entry.appendChild(content)
      this.list.appendChild(entry)
    }

    this.isReady = true
    this.updateVisibility()
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
    if (!this.onSelectPlayer) {
      return false
    }
    if (!this.localPlayerId) {
      return false
    }
    if (this.localHasCar) {
      return false
    }
    return !player.isNpc
  }

  private handleSelect(playerId: string): void {
    if (!this.onSelectPlayer) {
      return
    }
    this.onSelectPlayer(playerId)
  }
}
