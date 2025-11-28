import type { LeaderboardEntry, RacePhase, RaceState } from '../core/trackTypes'
import type { GameStateStore } from '../state/GameStateStore'

function formatCountdown(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return ''
  }
  return value <= 0 ? '0' : value.toFixed(1)
}

function phaseLabel(phase: RacePhase): string {
  switch (phase) {
    case 'countdown':
      return 'Preparando carrera'
    case 'race':
      return 'Carrera en curso'
    case 'postrace':
      return 'Resultados'
    default:
      return 'Lobby libre'
  }
}

export class RaceHud {
  private readonly root: HTMLElement
  private readonly status: HTMLElement
  private readonly leaderboard: HTMLElement
  private readonly laps: HTMLElement
  private readonly countdown: HTMLElement
  private readonly timers: HTMLElement
  private userHidden = false

  constructor(container: HTMLElement, store: GameStateStore) {
    this.root = document.createElement('div')
    this.root.className = 'race-hud'

    const header = document.createElement('div')
    header.className = 'race-hud__header'

    this.status = document.createElement('div')
    this.status.className = 'race-hud__status'
    header.appendChild(this.status)

    this.laps = document.createElement('div')
    this.laps.className = 'race-hud__laps'
    header.appendChild(this.laps)

    this.countdown = document.createElement('div')
    this.countdown.className = 'race-hud__countdown'
    header.appendChild(this.countdown)

    this.timers = document.createElement('div')
    this.timers.className = 'race-hud__timers'
    header.appendChild(this.timers)

    this.root.appendChild(header)

    this.leaderboard = document.createElement('div')
    this.leaderboard.className = 'race-hud__leaderboard'
    this.root.appendChild(this.leaderboard)

    container.appendChild(this.root)

    store.onState((state) => {
      this.render(state.race)
    })
  }

  toggleVisibility(): void {
    this.userHidden = !this.userHidden
    this.updateVisibility()
  }

  private updateVisibility(): void {
    this.root.hidden = this.userHidden
  }

  private render(race: RaceState): void {
    this.status.textContent = phaseLabel(race.phase)
    this.laps.textContent = `Vueltas: ${race.lapsRequired}`

    if (race.phase === 'countdown') {
      this.countdown.textContent = `Largada en ${formatCountdown(race.countdownRemaining)}s`
    } else {
      this.countdown.textContent = ''
    }

    if (race.phase === 'race' && race.finishTimeoutRemaining !== null) {
      this.timers.textContent = `Tiempo restante meta: ${race.finishTimeoutRemaining.toFixed(1)}s`
    } else if (race.phase === 'postrace' && race.postRaceRemaining !== null) {
      this.timers.textContent = `Volviendo al lobby en ${race.postRaceRemaining.toFixed(1)}s`
    } else {
      const readyStats = this.resolveReadyStats(race)
      this.timers.textContent =
        race.phase === 'lobby'
          ? `Ready: ${readyStats.ready}/${readyStats.total}`
          : ''
    }

    this.renderLeaderboard(race.leaderboard, race.phase)
  }

  private resolveReadyStats(race: RaceState): { ready: number; total: number } {
    let ready = 0
    let total = 0
    for (const entry of race.players) {
      if (entry.isNpc) {
        continue
      }
      total += 1
      if (entry.ready) {
        ready += 1
      }
    }
    return { ready, total }
  }

  private renderLeaderboard(entries: LeaderboardEntry[], phase: RacePhase): void {
    this.leaderboard.replaceChildren()

    if (entries.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'race-hud__empty'
      empty.textContent = 'Esperando jugadores...'
      this.leaderboard.appendChild(empty)
      return
    }

    for (const entry of entries) {
      const row = document.createElement('div')
      row.className = 'race-hud__row'

      const pos = document.createElement('div')
      pos.className = 'race-hud__col race-hud__col--pos'
      pos.textContent = entry.position.toString()
      row.appendChild(pos)

      const name = document.createElement('div')
      name.className = 'race-hud__col race-hud__col--name'
      name.textContent = entry.isNpc ? `${entry.playerId} · NPC` : entry.playerId
      row.appendChild(name)

      const lap = document.createElement('div')
      lap.className = 'race-hud__col race-hud__col--lap'
      lap.textContent = `V${entry.lap}`
      row.appendChild(lap)

      const gap = document.createElement('div')
      gap.className = 'race-hud__col race-hud__col--gap'
      if (entry.position === 1) {
        gap.textContent = entry.isFinished ? 'Ganador' : 'Líder'
      } else if (entry.gapToFirst !== null) {
        gap.textContent = `+${entry.gapToFirst.toFixed(1)}`
      }
      row.appendChild(gap)

      if (phase === 'lobby') {
        const ready = document.createElement('div')
        ready.className = 'race-hud__col race-hud__col--ready'
        ready.textContent = entry.ready ? 'Ready' : 'Pendiente'
        row.appendChild(ready)
      } else if (phase === 'postrace') {
        const finish = document.createElement('div')
        finish.className = 'race-hud__col race-hud__col--finish'
        finish.textContent =
          entry.isFinished && entry.finishTime !== undefined
            ? `${entry.finishTime.toFixed(2)}s`
            : 'DNF'
        row.appendChild(finish)
      }

      this.leaderboard.appendChild(row)
    }
  }
}
