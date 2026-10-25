// The panel the game shows in place of a title that can never finish loading: what went wrong in a sentence, a hint at
// the usual cause, and a button that tries again. It sits in the stage's HUD layer, like every other panel.
interface FailurePanelProps {
  title: string;
  message: string;
  hint?: string;
  action: string;
  onAction: () => void;
}

export function FailurePanel({ title, message, hint, action, onAction }: FailurePanelProps) {
  return (
    <div className="panel" data-panel="failure" role="alert">
      <div className="logo small">{title}</div>
      <p>{message}</p>
      {hint ? <p className="dim">{hint}</p> : null}
      <button className="btn big" onClick={onAction} type="button">
        {action}
      </button>
    </div>
  );
}
