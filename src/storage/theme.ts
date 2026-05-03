export function getStoredTheme(): 'light' | 'dark' | 'system' {
  return (localStorage.getItem('theme') as 'light' | 'dark' | 'system') || 'system'
}

export function setStoredTheme(theme: 'light' | 'dark' | 'system') {
  localStorage.setItem('theme', theme)
}

export function applyTheme(theme: 'light' | 'dark' | 'system') {
  const root = document.documentElement
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  if (isDark) {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

export function initTheme() {
  applyTheme(getStoredTheme())
  // Listen for system changes when in 'system' mode
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getStoredTheme() === 'system') {
      applyTheme('system')
    }
  })
}
