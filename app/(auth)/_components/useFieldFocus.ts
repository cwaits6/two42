"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Moves focus to a field after the render that marks it invalid, so a screen
 * reader reads the message through aria-describedby when focus lands.
 */
export function useFieldFocus(): (fieldId: string) => void {
  // An object, so a second submit with the same first error still refocuses.
  const [target, setTarget] = useState<{ id: string } | null>(null);
  useEffect(() => {
    if (target) document.getElementById(target.id)?.focus();
  }, [target]);
  return useCallback((id: string) => setTarget({ id }), []);
}
