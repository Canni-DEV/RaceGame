import './style.css'
import { ControllerApp } from './controller/ControllerApp'
import { SceneManager } from './scene/SceneManager'

type AppMode = 'viewer' | 'controller'

function resolveMode(): AppMode {
  const params = new URLSearchParams(window.location.search)
  const mode = params.get('mode')
  if (mode === 'controller') {
    return 'controller'
  }
  return 'viewer'
}

window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('app')
  if (!container) {
    throw new Error('App container not found')
  }

  const mode = resolveMode()
  if (mode === 'controller') {
    new ControllerApp(container)
    return
  }

  new SceneManager(container)
})
