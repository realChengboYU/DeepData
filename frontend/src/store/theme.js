import { create } from 'zustand'

const KEY = 'dd_theme'
const LIGHT_META = '#f7f8fa'
const DARK_META = '#0e0f12'

function systemPref() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function readStored() {
  if (typeof window === 'undefined') return null
  const v = localStorage.getItem(KEY)
  return v === 'dark' || v === 'light' ? v : null
}

function apply(theme) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', theme === 'dark' ? DARK_META : LIGHT_META)
}

const initial = readStored() ?? systemPref()
apply(initial)

export const useThemeStore = create((set, get) => ({
  theme: initial,
  setTheme: (t) => {
    apply(t)
    localStorage.setItem(KEY, t)
    set({ theme: t })
  },
  toggle: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    get().setTheme(next)
  },
}))

// 未手动选择时，跟随系统浅/深色
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem(KEY)) apply(e.matches ? 'dark' : 'light')
  })
}
