"use client"

import Link from "next/link"
import type { KeyboardEvent, ReactNode } from "react"

import { cn } from "@/lib/utils"

const groupClass = "inline-flex flex-wrap gap-1 rounded-xl border border-input bg-card p-1"

function optionClass(active: boolean) {
  return cn(
    "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg px-4 text-base font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
    active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-brand-warm"
  )
}

type Option<T> = { value: T; label: ReactNode }

type SegmentedProps<T extends string | number> = {
  label: string
  options: readonly Option<T>[]
  className?: string
} & (
  | { multiple?: false; value: T; onChange: (value: T) => void }
  | { multiple: true; value: readonly T[]; onChange: (value: T[]) => void }
)

const forward = (i: number, n: number) => (i + 1) % n
const back = (i: number, n: number) => (i - 1 + n) % n
const FOCUS_KEYS: Record<string, (index: number, count: number) => number> = {
  ArrowRight: forward,
  ArrowDown: forward,
  ArrowLeft: back,
  ArrowUp: back,
  Home: () => 0,
  End: (_, n) => n - 1,
}

/** Arrow keys, Home and End move focus between options; Enter and Space press it. */
function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  const target = FOCUS_KEYS[event.key]
  if (!target) return
  const buttons = Array.from(event.currentTarget.querySelectorAll("button"))
  const current = buttons.findIndex((button) => button === document.activeElement)
  if (current === -1) return
  event.preventDefault()
  buttons[target(current, buttons.length)].focus()
}

/**
 * Word-labeled pill buttons with `aria-pressed`: one choice, or several with
 * `multiple`. Options are words, never a color alone.
 */
function Segmented<T extends string | number>(props: SegmentedProps<T>) {
  const { label, options, className } = props
  const isPressed = (value: T) =>
    props.multiple ? props.value.includes(value) : props.value === value

  const press = (value: T) => {
    if (!props.multiple) return props.onChange(value)
    props.onChange(
      props.value.includes(value)
        ? props.value.filter((v) => v !== value)
        : [...props.value, value]
    )
  }

  return (
    <div
      role="group"
      aria-label={label}
      data-slot="segmented"
      onKeyDown={moveFocus}
      className={cn(groupClass, className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={isPressed(option.value)}
          onClick={() => press(option.value)}
          className={optionClass(isPressed(option.value))}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/**
 * The same pills as links, for a choice that lives in the URL. Links mark the
 * current one with `aria-current`; `aria-pressed` belongs to buttons.
 */
function SegmentedLinks({
  label,
  options,
  className,
}: {
  label: string
  options: readonly { href: string; label: ReactNode; current: boolean }[]
  className?: string
}) {
  return (
    <nav aria-label={label} data-slot="segmented" className={cn(groupClass, className)}>
      {options.map((option) => (
        <Link
          key={option.href}
          href={option.href}
          aria-current={option.current ? "page" : undefined}
          className={optionClass(option.current)}
        >
          {option.label}
        </Link>
      ))}
    </nav>
  )
}

export { Segmented, SegmentedLinks }
