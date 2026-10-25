// The pressed look for buttons that code presses. CSS shows a held mouse button or finger through :active, but a
// gamepad's A (actOnMenu clicks the focused button) and Enter go through code or ignore :active, so those mark the
// button with data-pressed for a moment, and the same CSS shows it (see the end of globals.css).
const HOLD_MILLISECONDS = 100;

const releases = new WeakMap<HTMLElement, number>();

export function flashPressed(button: HTMLElement) {
  window.clearTimeout(releases.get(button));
  button.dataset.pressed = "";
  releases.set(
    button,
    window.setTimeout(() => {
      delete button.dataset.pressed;
    }, HOLD_MILLISECONDS),
  );
}

// Enter and Space on a focused button press it; returns the unbind function
export function bindKeyboardPress(): () => void {
  const keyDown = (event: KeyboardEvent) => {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    if (event.target instanceof HTMLButtonElement && !event.target.disabled) {
      flashPressed(event.target);
    }
  };
  window.addEventListener("keydown", keyDown);
  return () => window.removeEventListener("keydown", keyDown);
}
