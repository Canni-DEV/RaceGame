export class HotkeyOverlay {
  private readonly root: HTMLElement

  constructor(container: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'hotkey-overlay'

    this.root.appendChild(this.createEntry('S', 'Sonido'))
    this.root.appendChild(this.createDot())
    this.root.appendChild(this.createEntry('R', 'Rotacion camara'))
    this.root.appendChild(this.createDot())
    this.root.appendChild(this.createEntry('C', 'Panel QR'))
    this.root.appendChild(this.createDot())
    this.root.appendChild(this.createEntry('F', 'Vista player/panorámica'))
    this.root.appendChild(this.createDot())
    this.root.appendChild(this.createEntry('P', 'Lista de players'))
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
