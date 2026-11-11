"use client"

import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

// The control is the 44 px touch target; the track inside it is purely visual.
function Slider({
  className,
  "aria-label": ariaLabel,
  ...props
}: SliderPrimitive.Root.Props<number> & { "aria-label": string }) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("w-full data-disabled:opacity-50", className)}
      {...props}
    >
      <SliderPrimitive.Control
        data-slot="slider-control"
        className="flex h-11 w-full touch-none items-center select-none"
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative h-1.5 w-full rounded-full bg-muted"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-indicator"
            className="rounded-full bg-primary"
          />
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            getAriaLabel={() => ariaLabel}
            className="relative block size-6 rounded-full border-2 border-primary bg-background outline-none before:absolute before:-inset-2.5 before:content-[''] has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
