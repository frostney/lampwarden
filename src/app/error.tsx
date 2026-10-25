"use client";

import { FailurePanel } from "@/components/FailurePanel";

// What the player sees when a page throws while rendering: the stage's own panel instead of Next's blank error page.
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="shell">
      <div className="stage">
        <div className="hud">
          <FailurePanel
            action="Try again"
            message="Something went wrong, and the page could not carry on."
            onAction={reset}
            title="THE LAMPS WENT OUT"
          />
        </div>
      </div>
    </main>
  );
}
