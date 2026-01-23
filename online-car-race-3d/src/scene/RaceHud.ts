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
    this.root.className = 'race-hud ui-panel'

    const header = document.createElement('div')
    header.className = 'race-hud__header'

    const headerLeft = document.createElement('div')
    headerLeft.className = 'race-hud__header-left'

    const headerIcon = document.createElement('span')
    headerIcon.className = 'ui-icon ui-icon--flag'
    headerLeft.appendChild(headerIcon)

    this.status = document.createElement('div')
    this.status.className = 'race-hud__status'
    headerLeft.appendChild(this.status)
    header.appendChild(headerLeft)

    const headerRight = document.createElement('div')
    headerRight.className = 'race-hud__header-right'

    this.laps = document.createElement('div')
    this.laps.className = 'race-hud__laps'
    headerRight.appendChild(this.laps)
    header.appendChild(headerRight)

    this.root.appendChild(header)

    const subheader = document.createElement('div')
    subheader.className = 'race-hud__subheader'

    this.countdown = document.createElement('div')
    this.countdown.className = 'race-hud__countdown'
    subheader.appendChild(this.countdown)

    this.timers = document.createElement('div')
    this.timers.className = 'race-hud__timers'
    subheader.appendChild(this.timers)

    this.root.appendChild(subheader)

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
    this.laps.textContent = `Lap: ${race.lapsRequired}`

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
    this.countdown.hidden = this.countdown.textContent.length === 0
    this.timers.hidden = this.timers.textContent.length === 0

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

      const isLeader = entry.position === 1
      row.classList.toggle('is-leader', isLeader)
      row.classList.toggle('is-npc', Boolean(entry.isNpc))

      const displayName = entry.username ?? entry.playerId
      const pos = document.createElement('div')
      pos.className = 'race-hud__pos-badge'
      pos.textContent = entry.position.toString()
      row.appendChild(pos)

      const main = document.createElement('div')
      main.className = 'race-hud__main'

      const name = document.createElement('div')
      name.className = 'race-hud__name'
      name.textContent = displayName
      main.appendChild(name)

      const meta = document.createElement('div')
      meta.className = 'race-hud__meta'
      const lap = document.createElement('span')
      lap.className = 'race-hud__meta-item race-hud__meta-lap'
      lap.textContent = `L${entry.lap}`
      meta.appendChild(lap)
      main.appendChild(meta)

      row.appendChild(main)

      const right = document.createElement('div')
      right.className = 'race-hud__right'

      const badges = document.createElement('div')
      badges.className = 'race-hud__badges'

      if (isLeader) {
        const leaderLabel = entry.isFinished ? 'Winner' : 'Leader'
        badges.appendChild(
          this.createBadge(leaderLabel, entry.isFinished ? 'winner' : 'leader'),
        )
      }

      if (entry.isNpc) {
        badges.appendChild(this.createBadge('NPC', 'npc'))
      }

      if (phase === 'lobby' && !entry.isNpc) {
        badges.appendChild(
          this.createBadge(entry.ready ? 'Ready' : 'Pending', entry.ready ? 'ready' : 'pending'),
        )
      } else if (phase === 'postrace') {
        badges.appendChild(this.createBadge(formatFinishTime(entry), entry.isFinished ? 'time' : 'pending'))
      } else if (!isLeader && entry.gapToFirst !== null) {
        badges.appendChild(this.createBadge(`+${entry.gapToFirst.toFixed(1)}`, 'gap'))
      }

      right.appendChild(badges)

      if (isLeader) {
        const actions = document.createElement('div')
        actions.className = 'race-hud__actions'
        actions.appendChild(this.createActionIcon('gear'))
        actions.appendChild(this.createActionIcon('signal'))
        right.appendChild(actions)
      }

      row.appendChild(right)

      this.leaderboard.appendChild(row)
    }
  }

  private createBadge(label: string, variant?: string): HTMLElement {
    const badge = document.createElement('span')
    badge.className = `race-hud__badge${variant ? ` race-hud__badge--${variant}` : ''}`
    badge.textContent = label
    return badge
  }

  private createActionIcon(name: string): HTMLElement {
    const icon = document.createElement('span')
    icon.className = `ui-icon ui-icon--${name} race-hud__action-icon`
    return icon
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
