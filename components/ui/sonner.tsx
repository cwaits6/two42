"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// Errors are mostly shown only as toasts, so every toast stays long enough to
// read and act on; Sonner also pauses the timer while a toast is hovered.
const TOAST_DURATION_MS = 10_000

// Clears the sticky header, so a toast never covers a page's primary action
// at the bottom of a phone screen or the menu button at the top.
const BELOW_HEADER = { top: 80 }

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      offset={BELOW_HEADER}
      mobileOffset={BELOW_HEADER}
      duration={TOAST_DURATION_MS}
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          // Sonner's own stylesheet is unlayered and sets 13px, so the type
          // scale has to win with !important to follow Settings → Text size.
          toast: "cn-toast text-base!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
