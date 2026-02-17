import { useRef, useState } from 'react'
import { PunkAvatar, getTraderAvatar } from './PunkAvatar'

type AvatarStyle = 'punk' | 'photo'

interface AvatarProfile {
  style: AvatarStyle
  photoUrl?: string
  hdPreviewUrl?: string
}

interface TraderAvatarProps {
  traderId: string
  traderName: string
  avatarUrl?: string
  avatarHdUrl?: string
  size?: number
  className?: string
  enableHdPreview?: boolean
}

const TRADER_AVATAR_PROFILES: Record<string, AvatarProfile> = {
  t_001: { style: 'punk' },
  t_002: { style: 'punk' },
  t_003: {
    style: 'photo',
    photoUrl: '/avatars/agent3.jpg',
    hdPreviewUrl: '/avatars/agent3-original.jpg',
  },
  t_004: {
    style: 'photo',
    photoUrl: '/avatars/agent4.jpg',
    hdPreviewUrl: '/avatars/agent4-original.jpg',
  },
}

function profileForTrader(
  traderId: string,
  avatarUrl?: string,
  avatarHdUrl?: string
): AvatarProfile {
  const dynamicAvatarUrl = String(avatarUrl || '').trim()
  const dynamicAvatarHdUrl = String(avatarHdUrl || '').trim()
  if (dynamicAvatarUrl) {
    return {
      style: 'photo',
      photoUrl: dynamicAvatarUrl,
      hdPreviewUrl: dynamicAvatarHdUrl || undefined,
    }
  }

  return TRADER_AVATAR_PROFILES[traderId] || { style: 'punk' }
}

export function TraderAvatar({
  traderId,
  traderName,
  avatarUrl,
  avatarHdUrl,
  size = 40,
  className = '',
  enableHdPreview = false,
}: TraderAvatarProps) {
  const profile = profileForTrader(traderId, avatarUrl, avatarHdUrl)
  const [showPreview, setShowPreview] = useState(false)
  const [previewPos, setPreviewPos] = useState<{
    top: number
    left: number
  } | null>(null)
  const avatarRef = useRef<HTMLSpanElement | null>(null)

  const openPreview = () => {
    if (!enableHdPreview || profile.style !== 'photo' || !profile.hdPreviewUrl)
      return
    const rect = avatarRef.current?.getBoundingClientRect()
    if (!rect) return

    const previewWidth = Math.min(
      420,
      Math.max(280, Math.floor(window.innerWidth * 0.32))
    )
    const previewHeight = Math.min(640, Math.floor(window.innerHeight * 0.82))
    const gap = 14

    let left = rect.right + gap
    if (left + previewWidth > window.innerWidth - 12) {
      left = Math.max(12, rect.left - previewWidth - gap)
    }

    const top = Math.max(
      12,
      Math.min(window.innerHeight - previewHeight - 12, rect.top - 24)
    )
    setPreviewPos({ top, left })
    setShowPreview(true)
  }

  const closePreview = () => {
    setShowPreview(false)
  }

  if (profile.style === 'photo' && profile.photoUrl) {
    return (
      <>
        <span
          ref={avatarRef}
          className="inline-flex"
          onMouseEnter={openPreview}
          onMouseLeave={closePreview}
          onFocus={openPreview}
          onBlur={closePreview}
        >
          <img
            src={profile.photoUrl}
            alt={`${traderName} avatar`}
            width={size}
            height={size}
            className={`object-cover ${className}`}
            loading="lazy"
          />
        </span>

        {enableHdPreview &&
          showPreview &&
          previewPos &&
          profile.hdPreviewUrl && (
            <div
              className="fixed z-[140] pointer-events-none"
              style={{ top: previewPos.top, left: previewPos.left }}
            >
              <div className="rounded-xl border border-white/20 bg-black/70 p-2 shadow-2xl backdrop-blur-sm">
                <img
                  src={profile.hdPreviewUrl}
                  alt={`${traderName} HD`}
                  className="block w-[min(420px,32vw)] max-h-[82vh] rounded-lg object-contain"
                  loading="lazy"
                />
                <div className="mt-1 text-[10px] font-semibold tracking-wide text-zinc-200/90">
                  HD PREVIEW
                </div>
              </div>
            </div>
          )}
      </>
    )
  }

  return (
    <PunkAvatar
      seed={getTraderAvatar(traderId, traderName)}
      size={size}
      className={className}
    />
  )
}
