export class HotkeyOverlay {
  private readonly root: HTMLElement

  constructor(container: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'hud-topbar'

    const banner = document.createElement('div')
    banner.className = 'hud-topbar__banner'
    const title = document.createElement('div')
    title.className = 'hud-topbar__title'
    title.textContent = 'MICRO RACE'
    banner.appendChild(title)
    this.root.appendChild(banner)

    const toolbar = document.createElement('div')
    toolbar.className = 'hud-topbar__toolbar'

    const actions = [
      { label: 'Sound', icon: 'sound' },
      { label: 'View', icon: 'view' },
      { label: 'Rotate', icon: 'rotate' },
      { label: 'Players', icon: 'players' },
      { label: 'HUD', icon: 'hud' },
      { label: 'Chat', icon: 'chat' },
    ]

    actions.forEach((action) => {
      toolbar.appendChild(this.createButton(action.label, action.icon))
    })

    this.root.appendChild(toolbar)
    container.appendChild(this.root)
  }

  private createButton(label: string, icon: string): HTMLElement {
    const button = document.createElement('div')
    button.className = 'hud-topbar__button'

    const iconEl = document.createElement('span')
    iconEl.className = `ui-icon ui-icon--${icon}`

    const text = document.createElement('span')
    text.className = 'hud-topbar__label'
    text.textContent = label

    button.appendChild(iconEl)
    button.appendChild(text)
    return button
  }
}
