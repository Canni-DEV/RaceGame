import type { LeaderboardEntry, RacePhase, RaceState } from '../core/trackTypes'
import type { GameStateStore } from '../state/GameStateStore'

function formatCountdown(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return ''
  }
  return value <= 0 ? '0' : value.toFixed(1)
}

function formatFinishTime(entry: LeaderboardEntry): string {
  if (!entry.isFinished || entry.finishTime === undefined || Number.isNaN(entry.finishTime)) {
    return 'DNF'
  }
  return `${entry.finishTime.toFixed(2)}s`
}

function phaseLabel(phase: RacePhase): string {
  switch (phase) {
    case 'countdown':
      return 'Preparing race'
    case 'race':
      return 'Race in progress'
    case 'postrace':
      return 'Results'
    default:
      return 'Open lobby'
  }
}

export class RaceHud {
  private readonly root: HTMLElement
  private readonly status: HTMLElement
  private readonly leaderboard: HTMLElement
  private readonly laps: HTMLElement
  private readonly countdown: HTMLElement
  private readonly timers: HTMLElement
  private readonly resultsOverlay: HTMLElement
  private readonly resultsSubtitle: HTMLElement
  private readonly resultsList: HTMLElement
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

    this.resultsOverlay = document.createElement('div')
    this.resultsOverlay.className = 'race-results'
    this.resultsOverlay.setAttribute('aria-hidden', 'true')

    const resultsCard = document.createElement('div')
    resultsCard.className = 'race-results__card'

    const resultsTitle = document.createElement('div')
    resultsTitle.className = 'race-results__title'
    resultsTitle.textContent = 'Final podium'
    resultsCard.appendChild(resultsTitle)

    this.resultsSubtitle = document.createElement('div')
    this.resultsSubtitle.className = 'race-results__subtitle'
    resultsCard.appendChild(this.resultsSubtitle)

    this.resultsList = document.createElement('div')
    this.resultsList.className = 'race-results__list'
    resultsCard.appendChild(this.resultsList)

    this.resultsOverlay.appendChild(resultsCard)
    container.appendChild(this.resultsOverlay)

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
    this.resultsOverlay.classList.toggle('is-hidden', this.userHidden)
  }

  private render(race: RaceState): void {
    this.status.textContent = phaseLabel(race.phase)
    this.laps.textContent = `Laps: ${race.lapsRequired}`

    if (race.phase === 'countdown') {
      this.countdown.textContent = `Start in ${formatCountdown(race.countdownRemaining)}s`
    } else {
      this.countdown.textContent = ''
    }

    if (race.phase === 'race' && race.finishTimeoutRemaining !== null) {
      this.timers.textContent = `Finish time remaining: ${race.finishTimeoutRemaining.toFixed(1)}s`
    } else if (race.phase === 'postrace' && race.postRaceRemaining !== null) {
      this.timers.textContent = `Returning to lobby in ${race.postRaceRemaining.toFixed(1)}s`
    } else {
      const readyStats = this.resolveReadyStats(race)
      this.timers.textContent =
        race.phase === 'lobby'
          ? `Ready: ${readyStats.ready}/${readyStats.total}`
          : ''
    }

    this.renderLeaderboard(race.leaderboard, race.phase)
    this.renderResults(race)
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
      empty.textContent = 'Waiting for players...'
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
      const displayName = entry.username ?? entry.playerId
      name.textContent = entry.isNpc ? `${displayName} · NPC` : displayName
      row.appendChild(name)

      const lap = document.createElement('div')
      lap.className = 'race-hud__col race-hud__col--lap'
      lap.textContent = `L${entry.lap}`
      row.appendChild(lap)

      const gap = document.createElement('div')
      gap.className = 'race-hud__col race-hud__col--gap'
      if (entry.position === 1) {
        gap.textContent = entry.isFinished ? 'Winner' : 'Leader'
      } else if (entry.gapToFirst !== null) {
        gap.textContent = `+${entry.gapToFirst.toFixed(1)}`
      }
      row.appendChild(gap)

      if (phase === 'lobby') {
        const ready = document.createElement('div')
        ready.className = 'race-hud__col race-hud__col--ready'
        ready.textContent = entry.ready ? 'Ready' : 'Pending'
        row.appendChild(ready)
      } else if (phase === 'postrace') {
        const finish = document.createElement('div')
        finish.className = 'race-hud__col race-hud__col--finish'
        finish.textContent = formatFinishTime(entry)
        row.appendChild(finish)
      }

      this.leaderboard.appendChild(row)
    }
  }

  private renderResults(race: RaceState): void {
    const isPostRace = race.phase === 'postrace'
    this.resultsOverlay.classList.toggle('is-active', isPostRace)
    this.resultsOverlay.setAttribute('aria-hidden', isPostRace ? 'false' : 'true')

    if (!isPostRace) {
      return
    }

    const countdown = formatCountdown(race.postRaceRemaining)
    this.resultsSubtitle.textContent = countdown
      ? `Returning to lobby in ${countdown}s`
      : 'Returning to lobby...'

    const podiumEntries = race.leaderboard
      .filter((entry) => entry.position <= 3)
      .sort((a, b) => a.position - b.position)

    this.resultsList.replaceChildren()

    if (podiumEntries.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'race-results__empty'
      empty.textContent = 'Final results are being tallied...'
      this.resultsList.appendChild(empty)
      return
    }

    for (const entry of podiumEntries) {
      const row = document.createElement('div')
      row.className = `race-results__row race-results__row--pos${entry.position}`

      const badge = document.createElement('div')
      badge.className = 'race-results__badge'
      badge.textContent = entry.position.toString()
      row.appendChild(badge)

      const name = document.createElement('div')
      name.className = 'race-results__name'
      const displayName = entry.username ?? entry.playerId
      name.textContent = entry.isNpc ? `${displayName} · NPC` : displayName
      row.appendChild(name)

      const time = document.createElement('div')
      time.className = 'race-results__time'
      time.textContent = formatFinishTime(entry)
      row.appendChild(time)

      this.resultsList.appendChild(row)
    }
  }
}
