import branding from "../../../branding.json";
import { LoaderCircle } from "lucide-react";
/** Shown before client route loading and scoped language services are ready. */
export function HydrateFallback() {
  return (
    <main
      className="hydrate-fallback"
      aria-label={`Starting ${branding.displayName}`}
      role="status"
    >
      <div className="hydrate-fallback-content">
        <LoaderCircle className="hydrate-fallback-spinner animate-spin" aria-hidden size={22} />
        <strong>{`Starting ${branding.displayName}\u2026`}</strong>
        <p>{"Loading the local workspace and native runtime."}</p>
      </div>
    </main>
  );
}
