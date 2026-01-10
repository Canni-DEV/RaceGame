export class HotkeyOverlay {
  private readonly root: HTMLElement

  constructor(container: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'hotkey-overlay'

    const entries: Array<[string, string]> = [
      ['S', 'Sonido'],
      ['F', 'Cambiar vista'],
      ['R', 'Rotacion camara'],
      ['Q', 'Panel QR'],
      ['P', 'Players'],
      ['C', 'HUD'],
    ]
    entries.forEach(([key, description], index) => {
      this.root.appendChild(this.createEntry(key, description))
      if (index < entries.length - 1) {
        this.root.appendChild(this.createDot())
      }
    })
    container.appendChild(this.root)
  }

  private createEntry(key: string, description: string): HTMLElement {
    const item = document.createElement('span')
    item.className = 'hotkey-overlay__item'

    const keyBadge = document.createElement('span')
    keyBadge.className = 'hotkey-overlay__key'
    keyBadge.textContent = key

    const text = document.createElement('span')
    text.className = 'hotkey-overlay__description'
    text.textContent = description

    item.appendChild(keyBadge)
    item.appendChild(text)
    return item
  }

  private createDot(): HTMLElement {
    const dot = document.createElement('span')
    dot.className = 'hotkey-overlay__separator'
    dot.textContent = '·'
    return dot
  }
}
