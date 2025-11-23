export class HotkeyOverlay {
  private readonly root: HTMLElement

  constructor(container: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'hotkey-overlay'

    const title = document.createElement('div')
    title.className = 'hotkey-overlay__title'
    title.textContent = 'Atajos rápidos'
    this.root.appendChild(title)

    const list = document.createElement('div')
    list.className = 'hotkey-overlay__list'

    list.appendChild(this.createEntry('C', 'Mostrar/ocultar panel QR'))
    list.appendChild(this.createEntry('F', 'Vista player / panorámica'))
    list.appendChild(this.createEntry('P', 'Mostrar/ocultar lista de players'))

    this.root.appendChild(list)
    container.appendChild(this.root)
  }

  private createEntry(key: string, description: string): HTMLElement {
    const item = document.createElement('div')
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
}
