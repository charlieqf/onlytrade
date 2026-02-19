import { useEffect } from 'react'

/**
 * Inject a <style> tag that locks html, body, and #root to exactly 100dvh
 * with overflow hidden. Uses !important to beat any global CSS rules
 * (e.g. `html { overflow-y: scroll }` in index.css).
 *
 * The style tag is removed on unmount so other pages aren't affected.
 */
export function useFullscreenLock() {
    useEffect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-fullscreen-lock', '')
        style.textContent = `
      html, body, #root {
        height: 100dvh !important;
        max-height: 100dvh !important;
        min-height: 0 !important;
        overflow: hidden !important;
        margin: 0 !important;
        padding: 0 !important;
      }
    `
        document.head.appendChild(style)

        return () => {
            style.remove()
        }
    }, [])
}
