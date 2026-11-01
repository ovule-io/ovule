import "./control-feedback.css";

export type ControlActivity = {
  /** Coordinates are CSS pixels relative to the surface, never screen coordinates. */
  x?: number;
  y?: number;
  pressed?: boolean;
};

/** Host-owned, non-interactive chrome. No page script, text or clipboard is copied here. */
export function installControlFeedback(host: HTMLElement, options: { desktop?: boolean } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "ovule-control-feedback";
  if (options.desktop) overlay.classList.add("ovule-control-feedback-desktop");
  overlay.setAttribute("aria-hidden", "true");
  const pointer = document.createElement("div");
  pointer.className = "ovule-control-pointer";
  overlay.append(pointer);
  host.append(overlay);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const clear = () => {
    clearTimeout(timer);
    overlay.removeAttribute("data-active");
    pointer.removeAttribute("data-visible");
    pointer.removeAttribute("data-pressed");
  };
  return {
    pulse(activity: ControlActivity = {}) {
      if (disposed) return;
      const width = host.clientWidth;
      const height = host.clientHeight;
      overlay.dataset.active = "true";
      if (Number.isFinite(activity.x) && Number.isFinite(activity.y)) {
        pointer.style.left = `${Math.max(0, Math.min(width, activity.x!))}px`;
        pointer.style.top = `${Math.max(0, Math.min(height, activity.y!))}px`;
        pointer.dataset.visible = "true";
        if (activity.pressed !== undefined) pointer.dataset.pressed = String(activity.pressed);
      }
      clearTimeout(timer);
      timer = setTimeout(clear, 1200);
    },
    clear,
    dispose() {
      disposed = true;
      clear();
      overlay.remove();
    },
  };
}
