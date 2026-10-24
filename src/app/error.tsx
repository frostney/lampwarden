"use client";

import { FailurePanel } from "@/components/FailurePanel";

// What the player sees when a page throws while rendering: the stage's own panel instead of Next's blank error page.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="shell">
      <div className="stage">
        <div className="hud">
          <FailurePanel
            title="THE LAMPS WENT OUT"
            message="Something broke before the night could begin."
            action="Try again"
            onAction={reset}
          />
        </div>
      </div>
    </main>
  );
}
