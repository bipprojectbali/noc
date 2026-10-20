/**
 * The two ways an open menu is closed from outside itself.
 *
 * Both listen on the document rather than on the menu, because neither event
 * starts there: Escape is pressed with the focus wherever the user left it, and
 * a dismissing click lands on whatever is not the menu. That the click reaches
 * this document at all is owed to the suppressor the open menu holds — without
 * it a click over a pane would be swallowed by a cross-origin iframe and the
 * menu would never close.
 *
 * Split out of `pane.menu` to keep that file inside its line budget once ⋮ grew
 * a second gesture. The seam is real enough: this is the menu's relationship
 * with the rest of the page, while what stayed behind is the menu itself.
 */

import { useEffect } from "react";
import type { RefObject } from "react";

export function usePaneMenuDismiss(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  onOpenChange: (open: boolean) => void,
): void {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    const onPointerDown = (event: MouseEvent) => {
      const root = rootRef.current;
      if (root !== null && root.contains(event.target as Node)) return;
      onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, rootRef, onOpenChange]);
}
