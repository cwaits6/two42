"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import {
  INITIAL_CROP,
  MAX_ZOOM,
  MIN_ZOOM,
  VIEWPORT,
  clampCrop,
  displayScale,
  renderCrop,
  zoomCrop,
  type CropState,
} from "@/lib/avatarCrop";
import { logWarn } from "@/lib/log";

export interface AvatarCropStepProps {
  file: File;
  /** Receives focus when the step closes, after the dialog has gone. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  onSave: (cropped: File) => Promise<void>;
  onLoadError: () => void;
  /** Called once the step has fully closed, whether saved, cancelled or failed. */
  onClosed: () => void;
}

type Loaded = { img: HTMLImageElement; url: string; w: number; h: number };
type Point = { x: number; y: number };

const MOVE_STEP = 8;
const MOVE_STEP_LARGE = 32;
const ZOOM_STEP = 0.1;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function AvatarCropStep({
  file,
  returnFocusRef,
  onSave,
  onLoadError,
  onClosed,
}: AvatarCropStepProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [crop, setCrop] = useState<CropState>(INITIAL_CROP);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const descriptionId = useId();

  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ crop: CropState; pinch: number | null }>({
    crop: INITIAL_CROP,
    pinch: null,
  });

  const failToLoad = useEffectEvent(() => {
    logWarn("AvatarCropStep: photo failed to load");
    onLoadError();
    onClosed();
  });

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    let cancelled = false;
    img.src = url;
    img
      .decode()
      .then(() => {
        if (cancelled) return;
        setLoaded({ img, url, w: img.naturalWidth, h: img.naturalHeight });
        setCrop(INITIAL_CROP);
        setOpen(true);
      })
      .catch(() => {
        if (!cancelled) failToLoad();
      });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  if (!loaded) return null;
  const { w, h } = loaded;

  const move = (dx: number, dy: number) =>
    setCrop((from) => clampCrop({ ...from, x: from.x + dx, y: from.y + dy }, w, h));
  const zoomTo = (zoom: number) => setCrop((from) => zoomCrop(from, zoom, w, h));

  const startGesture = () => {
    const points = [...pointers.current.values()];
    gesture.current = {
      crop,
      pinch: points.length >= 2 ? distance(points[0], points[1]) : null,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (saving) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    startGesture();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(e.pointerId);
    if (!previous) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const points = [...pointers.current.values()];
    const { pinch } = gesture.current;
    if (pinch && points.length >= 2) {
      zoomTo(gesture.current.crop.zoom * (distance(points[0], points[1]) / pinch));
    } else if (points.length === 1) {
      move(e.clientX - previous.x, e.clientY - previous.y);
    }
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    startGesture();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? MOVE_STEP_LARGE : MOVE_STEP;
    switch (e.key) {
      case "ArrowLeft":
        move(-step, 0);
        break;
      case "ArrowRight":
        move(step, 0);
        break;
      case "ArrowUp":
        move(0, -step);
        break;
      case "ArrowDown":
        move(0, step);
        break;
      case "+":
      case "=":
        zoomTo(crop.zoom + ZOOM_STEP);
        break;
      case "-":
      case "_":
        zoomTo(crop.zoom - ZOOM_STEP);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const save = async () => {
    setSaving(true);
    try {
      const cropped = await renderCrop(loaded.img, crop);
      await onSave(cropped);
    } catch {
      logWarn("AvatarCropStep: crop failed");
      onLoadError();
    } finally {
      setSaving(false);
      setOpen(false);
    }
  };

  const scale = displayScale(w, h, crop.zoom);
  const shownW = w * scale;
  const shownH = h * scale;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) setOpen(false);
      }}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onClosed();
      }}
    >
      <DialogContent
        finalFocus={returnFocusRef}
        showCloseButton={!saving}
        className="motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none"
      >
        <DialogHeader>
          <DialogTitle>Crop photo</DialogTitle>
          <DialogDescription id={descriptionId}>
            Drag the photo to move it. Pinch or use the slider to zoom. Arrow keys move it, plus
            and minus zoom.
          </DialogDescription>
        </DialogHeader>

        <div
          role="group"
          aria-label="Photo position"
          aria-describedby={descriptionId}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          className="relative mx-auto cursor-grab touch-none overflow-hidden rounded-xl bg-muted outline-none select-none active:cursor-grabbing focus-visible:ring-3 focus-visible:ring-ring/50"
          style={{ width: VIEWPORT, height: VIEWPORT }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset */}
          <img
            src={loaded.url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none"
            style={{
              width: shownW,
              height: shownH,
              left: (VIEWPORT - shownW) / 2 + crop.x,
              top: (VIEWPORT - shownH) / 2 + crop.y,
            }}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_200px] shadow-foreground/50 ring-2 ring-background"
          />
        </div>

        <div className="space-y-1">
          <span aria-hidden="true" className="text-base font-medium">
            Zoom
          </span>
          <Slider
            aria-label="Zoom"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            disabled={saving}
            onValueChange={(zoom) => zoomTo(zoom)}
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={save}>
            {saving ? "Saving…" : "Save photo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
