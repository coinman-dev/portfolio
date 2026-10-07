/**
 * Native layers drawn over the page — the embedded Jumper view — cover any
 * HTML beneath them, including our own pop-ups. Code that shows one (the
 * WalletConnect QR code lives in a shadow root nobody else can see) holds
 * the overlay while it is up, and such layers step aside meanwhile.
 */

let holds = 0;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** Marks a pop-up as open; call the returned function once it has closed. */
export function holdOverlay(): () => void {
  holds += 1;
  notify();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    notify();
  };
}

export const overlayHeld = (): boolean => holds > 0;

export function onOverlayChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
