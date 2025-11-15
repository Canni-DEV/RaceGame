import './style.css'
import { SceneManager } from './scene/SceneManager'

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('app')
  if (!container) {
    throw new Error('App container not found')
  }

  new SceneManager(container)
})
