"use client";

import { useEffect, useRef, useSyncExternalStore, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";

const subscribe = () => () => undefined;
const layers: HTMLElement[] = [];
const originalInert = new Map<HTMLElement, boolean>();
let originalOverflow = "";
const focusable = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function visibleControls(layer: HTMLElement) {
  return Array.from(layer.querySelectorAll<HTMLElement>(focusable)).filter(element => !element.closest("[inert]") && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
}

function isolateTopLayer() {
  for (const [element, inert] of originalInert) element.inert = inert;
  originalInert.clear();
  const top = layers.at(-1);
  if (!top) return;
  for (const element of Array.from(document.body.children)) {
    if (!(element instanceof HTMLElement) || element === top || element.contains(top) || element.dataset.modalAnnouncer !== undefined) continue;
    originalInert.set(element, element.inert);
    element.inert = true;
  }
}

/** Existing dialogs share one focus/scroll boundary; no clinical state lives here. */
export default function ModalLayer({ children, onDismiss, dismissDisabled = false, ...props }: HTMLAttributes<HTMLDivElement> & { children: ReactNode; onDismiss?: () => void; dismissDisabled?: boolean }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  const ref = useRef<HTMLDivElement>(null);
  const dismiss = useRef({ onDismiss, dismissDisabled });
  useEffect(() => { dismiss.current = { onDismiss, dismissDisabled }; }, [onDismiss, dismissDisabled]);
  useEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!layers.length) { originalOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    layers.push(layer);
    isolateTopLayer();
    const focusFirst = () => (visibleControls(layer)[0] || layer).focus({ preventScroll: true });
    if (!layer.contains(document.activeElement)) focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (layers.at(-1) !== layer) return;
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault(); event.stopPropagation();
        if (!dismiss.current.dismissDisabled) dismiss.current.onDismiss?.();
      }
      if (event.key === "Tab") {
        const controls = visibleControls(layer);
        const first = controls[0], last = controls.at(-1);
        if (!first) { event.preventDefault(); layer.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last!.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !layer.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    const focusin = (event: FocusEvent) => { if (layers.at(-1) === layer && !layer.contains(event.target as Node)) focusFirst(); };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("focusin", focusin);
      const index = layers.indexOf(layer); if (index >= 0) layers.splice(index, 1);
      isolateTopLayer();
      if (!layers.length) document.body.style.overflow = originalOverflow;
      if (previous?.isConnected && !previous.closest("[inert]")) previous.focus({ preventScroll: true });
      else if (layers.at(-1)) (visibleControls(layers.at(-1)!)[0] || layers.at(-1)!).focus({ preventScroll: true });
    };
  }, [mounted]);
  return mounted ? createPortal(<div {...props} data-modal-layer="" ref={ref} tabIndex={-1}>{children}</div>, document.body) : null;
}
