'use client'

import { useState, useEffect } from 'react'

/**
 * Hook for detecting scroll direction to implement smart navbar behavior.
 * Returns `isVisible` boolean:
 * - true: navbar should be visible
 * - false: navbar should be hidden
 *
 * Behavior (Facebook-style):
 * - Navbar is visible when near the top (scrollY < 10)
 * - Navbar hides when scrolling down
 * - Navbar shows when scrolling up
 * - Uses requestAnimationFrame for performance
 */
export function useScrollDirection() {
  const [isVisible, setIsVisible] = useState(true)
  const [lastScrollY, setLastScrollY] = useState(0)
  const [isTicking, setIsTicking] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      if (!isTicking) {
        window.requestAnimationFrame(() => {
          const currentScrollY = window.scrollY

          // Always show navbar when near top
          if (currentScrollY < 10) {
            setIsVisible(true)
          } else {
            // Hide on scroll down, show on scroll up
            setIsVisible(currentScrollY < lastScrollY)
          }

          setLastScrollY(currentScrollY)
          setIsTicking(false)
        })
        setIsTicking(true)
      }
    }

    // Passive listener for better scroll performance
    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [lastScrollY, isTicking])

  return isVisible
}
