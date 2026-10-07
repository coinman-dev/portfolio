/** Opens a URL in the user's default browser via the Tauri bridge,
 *  falling back to window.open when running outside the desktop shell. */
export function openExternal(url: string): void {
  const bridge = (window as any).AppBridge;
  if (bridge && typeof bridge.invoke === 'function') {
    try {
      bridge.invoke('open_url', { url });
      return;
    } catch (err) {
      console.warn('[Earn] open_url bridge failed:', err);
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
