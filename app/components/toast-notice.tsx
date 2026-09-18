"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const subscribe = () => () => undefined;
export default function ToastNotice({ message }: { message: string }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return mounted && message ? createPortal(<div data-modal-announcer="" className="formation-toast" role="status" aria-live="polite" aria-atomic="true">{message}</div>, document.body) : null;
}
