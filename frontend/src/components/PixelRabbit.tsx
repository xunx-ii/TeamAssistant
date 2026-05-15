import { memo } from 'react'

interface Props {
  size?: number
  className?: string
  animate?: boolean
}

export const PixelRabbit = memo(function PixelRabbit({ size = 64, className = '', animate = false }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={`${className} ${animate ? 'pixel-rabbit-bounce' : ''}`}
      style={{ imageRendering: 'pixelated' }}
    >
      {/* Left ear */}
      <rect x="9" y="0" width="2" height="2" fill="#FFB6C1" />
      <rect x="9" y="2" width="2" height="2" fill="#FFB6C1" />
      <rect x="9" y="4" width="2" height="2" fill="#FFB6C1" />
      <rect x="9" y="6" width="2" height="2" fill="#FFB6C1" />
      <rect x="10" y="0" width="2" height="2" fill="#FF69B4" />
      <rect x="10" y="2" width="2" height="2" fill="#FF69B4" />
      <rect x="10" y="4" width="2" height="2" fill="#FF69B4" />
      <rect x="10" y="6" width="2" height="2" fill="#FF69B4" />
      {/* Right ear */}
      <rect x="21" y="0" width="2" height="2" fill="#FFB6C1" />
      <rect x="21" y="2" width="2" height="2" fill="#FFB6C1" />
      <rect x="21" y="4" width="2" height="2" fill="#FFB6C1" />
      <rect x="21" y="6" width="2" height="2" fill="#FFB6C1" />
      <rect x="20" y="0" width="2" height="2" fill="#FF69B4" />
      <rect x="20" y="2" width="2" height="2" fill="#FF69B4" />
      <rect x="20" y="4" width="2" height="2" fill="#FF69B4" />
      <rect x="20" y="6" width="2" height="2" fill="#FF69B4" />
      {/* Head */}
      <rect x="8" y="8" width="16" height="2" fill="#FFB6C1" />
      <rect x="6" y="10" width="20" height="2" fill="#FFB6C1" />
      <rect x="6" y="12" width="20" height="2" fill="#FFB6C1" />
      <rect x="6" y="14" width="20" height="2" fill="#FFB6C1" />
      <rect x="6" y="16" width="20" height="2" fill="#FFB6C1" />
      <rect x="8" y="18" width="16" height="2" fill="#FFB6C1" />
      <rect x="8" y="20" width="16" height="2" fill="#FFB6C1" />
      {/* Eyes */}
      <rect x="10" y="12" width="2" height="2" fill="#333" />
      <rect x="12" y="12" width="2" height="2" fill="#333" />
      <rect x="10" y="14" width="2" height="2" fill="#333" />
      <rect x="12" y="14" width="2" height="2" fill="#333" />
      <rect x="20" y="12" width="2" height="2" fill="#333" />
      <rect x="18" y="12" width="2" height="2" fill="#333" />
      <rect x="20" y="14" width="2" height="2" fill="#333" />
      <rect x="18" y="14" width="2" height="2" fill="#333" />
      {/* Eye highlights */}
      <rect x="10" y="12" width="2" height="2" fill="#FFF" opacity="0.7" />
      <rect x="18" y="12" width="2" height="2" fill="#FFF" opacity="0.7" />
      {/* Nose */}
      <rect x="15" y="16" width="2" height="2" fill="#FF69B4" />
      {/* Mouth */}
      <rect x="13" y="18" width="6" height="2" fill="#FF8C94" />
      {/* Cheeks */}
      <rect x="6" y="16" width="4" height="2" fill="#FFD1DC" opacity="0.7" />
      <rect x="22" y="16" width="4" height="2" fill="#FFD1DC" opacity="0.7" />
      {/* Body */}
      <rect x="10" y="22" width="12" height="2" fill="#FFB6C1" />
      <rect x="10" y="24" width="12" height="2" fill="#FFB6C1" />
      <rect x="10" y="26" width="12" height="2" fill="#FFB6C1" />
      {/* Feet */}
      <rect x="8" y="28" width="4" height="2" fill="#FFB6C1" />
      <rect x="20" y="28" width="4" height="2" fill="#FFB6C1" />
      <rect x="8" y="30" width="4" height="2" fill="#FF69B4" />
      <rect x="20" y="30" width="4" height="2" fill="#FF69B4" />
    </svg>
  )
})

export const PixelHeart = memo(function PixelHeart({ size = 24, className = '' }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width={size} height={size} className={className} style={{ imageRendering: 'pixelated' }}>
      <rect x="4" y="8" width="8" height="4" fill="#FF6B6B" />
      <rect x="20" y="8" width="8" height="4" fill="#FF6B6B" />
      <rect x="2" y="12" width="12" height="4" fill="#FF6B6B" />
      <rect x="18" y="12" width="12" height="4" fill="#FF6B6B" />
      <rect x="2" y="16" width="28" height="4" fill="#FF6B6B" />
      <rect x="4" y="20" width="24" height="4" fill="#FF6B6B" />
      <rect x="8" y="24" width="16" height="4" fill="#FF6B6B" />
      <rect x="12" y="28" width="8" height="4" fill="#FF6B6B" />
      <rect x="6" y="12" width="2" height="2" fill="#FF8E8E" />
      <rect x="4" y="14" width="2" height="2" fill="#FF8E8E" />
    </svg>
  )
})

export const PixelStar = memo(function PixelStar({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width={size} height={size} className={className} style={{ imageRendering: 'pixelated' }}>
      <rect x="14" y="0" width="4" height="4" fill="#FFD700" />
      <rect x="12" y="4" width="8" height="4" fill="#FFD700" />
      <rect x="2" y="8" width="28" height="4" fill="#FFD700" />
      <rect x="6" y="12" width="20" height="4" fill="#FFD700" />
      <rect x="8" y="16" width="16" height="4" fill="#FFD700" />
      <rect x="4" y="20" width="10" height="4" fill="#FFD700" />
      <rect x="18" y="20" width="10" height="4" fill="#FFD700" />
      <rect x="2" y="24" width="8" height="4" fill="#FFD700" />
      <rect x="22" y="24" width="8" height="4" fill="#FFD700" />
    </svg>
  )
})

export const PixelCarrot = memo(function PixelCarrot({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width={size} height={size} className={className} style={{ imageRendering: 'pixelated' }}>
      <rect x="12" y="0" width="4" height="4" fill="#4CAF50" />
      <rect x="16" y="2" width="4" height="4" fill="#66BB6A" />
      <rect x="8" y="2" width="4" height="4" fill="#388E3C" />
      <rect x="10" y="6" width="12" height="4" fill="#FF9800" />
      <rect x="12" y="10" width="8" height="4" fill="#FF9800" />
      <rect x="14" y="14" width="4" height="4" fill="#FF9800" />
      <rect x="14" y="18" width="4" height="4" fill="#FB8C00" />
      <rect x="14" y="22" width="4" height="4" fill="#F57C00" />
      <rect x="15" y="26" width="2" height="4" fill="#E65100" />
    </svg>
  )
})