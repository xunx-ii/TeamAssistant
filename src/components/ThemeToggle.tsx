import { useState, useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'
import { getStoredTheme, setStoredTheme, applyTheme } from '../storage/theme'

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(getStoredTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const cycle = () => {
    const next = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark'
    setTheme(next)
    setStoredTheme(next)
  }

  const icon = theme === 'dark' ? <Moon className="h-4 w-4" /> : theme === 'light' ? <Sun className="h-4 w-4" /> : <Sun className="h-4 w-4" />

  const label = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🎮'

  return (
    <button
      className="fixed bottom-4 right-4 z-50 inline-flex items-center justify-center gap-1.5 rounded border-2 border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-md hover:text-foreground hover:border-primary/50 transition-colors"
      onClick={cycle}
      title={`当前：${theme === 'dark' ? '暗色' : theme === 'light' ? '浅色' : '跟随系统'}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
