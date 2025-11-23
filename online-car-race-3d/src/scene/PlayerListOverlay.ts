import type { GameStateStore } from '../state/GameStateStore'
import type { PlayerSummary } from '../net/messages'
import type { RoomState } from '../core/trackTypes'

export class PlayerListOverlay {
  private readonly root: HTMLElement
  private readonly list: HTMLElement
  private readonly playerSpeeds: Map<string, number>
  private players: PlayerSummary[] = []
  private userHidden = false
  private isReady = false

  constructor(container: HTMLElement, store: GameStateStore) {
    this.playerSpeeds = new Map()

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
    const playersInRace: PlayerSummary[] = []

    for (const car of state.cars) {
      this.playerSpeeds.set(car.playerId, Math.abs(car.speed))
      playersInRace.push({ playerId: car.playerId, isNpc: car.isNpc })
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
      const speed = document.createElement('div')
      speed.className = 'player-list-overlay__speed'
      speed.textContent =
        speedValue === undefined
          ? 'Sin datos de velocidad'
          : `Velocidad: ${speedValue.toFixed(1)} u`
      content.appendChild(speed)

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
}
