# Phase 11: Mobile-Responsive Design - Research

**Researched:** 2026-02-16
**Domain:** Mobile UI/UX Implementation
**Confidence:** HIGH

## Summary

This phase focuses on adapting the existing desktop-first application for mobile devices (320px+). The primary challenges are navigation (tab bar vs sidebar), data presentation (tables vs cards), and interaction patterns (touch targets, gestures).

The standard approach for Next.js/Tailwind applications is to use **responsive utility classes** for layout shifts, **Vaul** for mobile-native drawer interactions, and **CSS variables** (like `100dvh`) to handle viewport quirks. We will not build a separate mobile app but will aggressively adapt the DOM structure using CSS Grid/Flexbox and conditional rendering where necessary.

**Primary recommendation:** Use `vaul` for all mobile modals/actions and transform TanStack Tables into "Card Views" using CSS grid/block layouts on mobile.

## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| **Vaul** | Latest | Mobile Drawers/Sheets | The standard for "iOS-like" drawers in React/Radix ecosystem. Handles gestures, snap points, and focus management better than standard Dialogs. |
| **Tailwind CSS** | v3.4+ | Styling & Response | Already installed. Uses `md:`, `lg:` prefixes to handle breakpoints. |
| **Lucide React** | Latest | Icons | Already installed. Lightweight, consistent stroke width suitable for mobile. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **React Use** | (Optional) | `useWindowSize` | If JS-based conditional rendering is strictly needed (prefer CSS `hidden md:block`). |
| **clsx/tw-merge** | Latest | Class manipulation | Managing complex conditional classes for touch states. |

**Installation:**
```bash
npm install vaul
```

## Architecture Patterns

### 1. The "Smart" Tab Bar (Mobile Nav)
Instead of a sidebar, mobile uses a bottom or top tab bar. The requirement specifies a **Top Tab Bar** with smart scroll behavior.

**Structure:**
```tsx
// components/mobile-nav.tsx
export function MobileNav() {
  const isVisible = useScrollDirection(); // Custom hook returning boolean

  return (
    <nav className={cn(
      "fixed top-0 w-full z-50 transition-transform duration-300",
      isVisible ? "translate-y-0" : "-translate-y-full"
    )}>
      {/* Tab Items */}
    </nav>
  );
}
```

### 2. Table-to-Card Transformation
Do not try to make tables scroll horizontally as the *primary* view. Convert rows to cards.

**Pattern:**
*   **Desktop:** standard `<table>` rendering.
*   **Mobile:** `<div>` grid rendering where each "row" is a card container.
*   **Implementation:** Use TanStack Table's headless nature. Iterate rows and render a `<MobileCard row={row} />` component for mobile breakpoints (hidden on desktop), or use CSS `display: grid` to re-orient standard table cells (harder to style).
*   **Recommendation:** Conditional rendering of two view components (`<TableView />` vs `<CardView />`) is often cleaner than complex CSS contortions for complex data.

### 3. Mobile Actions & Safe Areas
Fixed position elements (bottom bars) must respect iOS Safe Areas.

**Pattern:**
```tsx
<div className="fixed bottom-0 w-full pb-[env(safe-area-inset-bottom)] bg-white border-t">
  <div className="h-16 flex items-center justify-between px-4">
    {/* Buttons */}
  </div>
</div>
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| **Drawers/Sheets** | Custom div with `translate-y` | **Vaul** | Drag gestures, momentum scrolling, and background scaling are incredibly hard to get "native-feeling". |
| **Scroll Detection** | `window.addEventListener('scroll')` | **`useScrollDirection` hook** | Performance (throttling) and state management nuances. |
| **Icons** | SVGs from scratch | **Lucide React** | Consistent size and stroke width. |
| **Touch Ripples** | Custom CSS/JS | **Active States** | Use standard CSS `:active` classes (`active:bg-gray-100`) for immediate feedback. |

## Common Pitfalls

### Pitfall 1: The `100vh` Bug
**What goes wrong:** Mobile browser address bars cover the bottom of `100vh` elements.
**How to avoid:** Use `h-[100dvh]` (Dynamic Viewport Height) in Tailwind 3.4+.
**Example:** `min-h-[100dvh]` for the main page container.

### Pitfall 2: Input Zoom
**What goes wrong:** iOS zooms in when focusing inputs with font-size < 16px.
**How to avoid:** Ensure all input classes use `text-base` (16px) on mobile.
**Tailwind:** `text-base md:text-sm`.

### Pitfall 3: Tap Targets
**What goes wrong:** Buttons are too small to tap reliably.
**How to avoid:** Enforce `min-h-[44px]` and `min-w-[44px]` on interactive elements. Use padding to increase hit area without increasing visual size if needed.

### Pitfall 4: Safe Area Obstruction
**What goes wrong:** Fixed bottom buttons sit behind the iOS home indicator.
**How to avoid:** Always add `pb-[env(safe-area-inset-bottom)]` to fixed bottom containers.

## Code Examples

### Smart Scroll Hook
```typescript
// hooks/use-scroll-direction.ts
import { useState, useEffect } from 'react';

export function useScrollDirection() {
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  useEffect(() => {
    const controlNavbar = () => {
      const currentScrollY = window.scrollY;
      
      if (currentScrollY < 10) {
        setIsVisible(true);
      } else {
         // Show on scroll up, hide on scroll down
        setIsVisible(currentScrollY < lastScrollY);
      }
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', controlNavbar);
    return () => window.removeEventListener('scroll', controlNavbar);
  }, [lastScrollY]);

  return isVisible;
}
```

### Mobile File Upload (Camera Trigger)
```tsx
// Using standard HTML attributes for mobile native behavior
<input 
  type="file" 
  accept="image/*" 
  capture="environment" // Triggers back camera on mobile
  className="hidden" 
  id="camera-upload"
/>
<label 
  htmlFor="camera-upload"
  className="flex items-center justify-center w-full h-12 bg-blue-600 text-white rounded-lg active:bg-blue-700"
>
  <CameraIcon className="mr-2" />
  Take Photo
</label>
```

### Vaul Drawer Implementation
```tsx
import { Drawer } from 'vaul';

export function RequestDetails({ isOpen, onClose, children }) {
  return (
    <Drawer.Root open={isOpen} onOpenChange={onClose}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40" />
        <Drawer.Content className="bg-white flex flex-col rounded-t-[10px] h-[96%] mt-24 fixed bottom-0 left-0 right-0 outline-none">
          <div className="p-4 bg-white rounded-t-[10px] flex-1 overflow-y-auto">
            <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-zinc-300 mb-8" />
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| **Separate Mobile Site** | **Responsive Design** | Single codebase, unified state. |
| **JS Height Calc** | **CSS `dvh` units** | Smoother, CSS-native viewport handling. |
| **Custom Touch Libs** | **CSS Snap / Native** | Browser native scrolling is now performant enough for most cases. |
| **Dialogs for everything** | **Drawers (Bottom Sheets)** | Better reachability (thumb zone) on large phones. |

## Sources

### Primary (HIGH confidence)
- **Vaul Docs** - Standard for React Drawers.
- **Tailwind CSS Docs** - `touch-action`, `dvh` support.
- **MDN Web Docs** - `capture` attribute for file inputs, `env()` CSS variables.

### Secondary (MEDIUM confidence)
- **TanStack Table Examples** - "Div table" approaches for responsive layouts.

## Metadata
**Confidence breakdown:**
- Standard stack: HIGH (Vaul + Tailwind is definitive)
- Architecture: HIGH (Smart scroll and Card views are standard patterns)
- Pitfalls: HIGH (Well-documented iOS quirks)

**Research date:** 2026-02-16
