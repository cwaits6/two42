"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Segmented } from "@/components/ui/segmented";

type TextSize = "normal" | "large" | "larger";

const TEXT_SIZE_OPTIONS: { value: TextSize; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "large", label: "Large" },
  { value: "larger", label: "Larger" },
];

function persist(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private browsing can block storage; the choice still applies this visit.
  }
}

export function DisplayCard() {
  const [textSize, setTextSize] = useState<TextSize>("normal");

  // The <head> script applied the saved pref before paint; sync state to it.
  useEffect(() => {
    const saved = document.documentElement.dataset.textsize;
    if (saved === "large" || saved === "larger") setTextSize(saved);
  }, []);

  const applyTextSize = (size: TextSize) => {
    setTextSize(size);
    const root = document.documentElement;
    if (size === "normal") {
      delete root.dataset.textsize;
      persist("pref-textsize", null);
    } else {
      root.dataset.textsize = size;
      persist("pref-textsize", size);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <h3>Display</h3>

        <div className="space-y-2">
          <Label className="text-base">Text size</Label>
          <div>
            <Segmented
              label="Text size"
              options={TEXT_SIZE_OPTIONS}
              value={textSize}
              onChange={applyTextSize}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
