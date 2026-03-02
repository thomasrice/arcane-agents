interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog shortcuts-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-title">Keyboard Shortcuts</div>
        <div className="shortcut-grid">
          <div className="shortcut-row">
            <kbd>1-0</kbd>
            <span>Select control group</span>
          </div>
          <div className="shortcut-row">
            <kbd>Ctrl+1-0</kbd>
            <span>Assign selected agent to group</span>
          </div>
          <div className="shortcut-row">
            <kbd>Tab</kbd>
            <span>Select next agent (or cycle selected group focus)</span>
          </div>
          <div className="shortcut-row">
            <kbd>Shift+Tab</kbd>
            <span>Select previous agent (or cycle selected group focus)</span>
          </div>
          <div className="shortcut-row">
            <kbd>. / , / Shift+.</kbd>
            <span>Cycle idle agents only</span>
          </div>
          <div className="shortcut-row">
            <kbd>J / K</kbd>
            <span>Move selection in roster and summon list</span>
          </div>
          <div className="shortcut-row">
            <kbd>C</kbd>
            <span>Focus Rally Command input (selected group view)</span>
          </div>
          <div className="shortcut-row">
            <kbd>N</kbd>
            <span>Jump to summon list</span>
          </div>
          <div className="shortcut-row">
            <kbd>W/A/S/D</kbd>
            <span>Move selected agent(s) smoothly (hold)</span>
          </div>
          <div className="shortcut-row">
            <kbd>Shift+W/A/S/D</kbd>
            <span>Pan map</span>
          </div>
          <div className="shortcut-row">
            <kbd>[ / ] / =</kbd>
            <span>Resize columns or reset split</span>
          </div>
          <div className="shortcut-row">
            <kbd>Enter</kbd>
            <span>Activate highlighted item or focus terminal</span>
          </div>
          <div className="shortcut-row">
            <kbd>Ctrl+] / Ctrl+D</kbd>
            <span>Leave terminal focus; in selected group view, return to group list</span>
          </div>
          <div className="shortcut-row">
            <kbd>R</kbd>
            <span>Rename selected agent</span>
          </div>
          <div className="shortcut-row">
            <kbd>M</kbd>
            <span>Toggle mode on selected agent</span>
          </div>
          <div className="shortcut-row">
            <kbd>K</kbd>
            <span>Open kill confirm (Shift+K in selected group view)</span>
          </div>
          <div className="shortcut-row">
            <kbd>Shift+K</kbd>
            <span>Kill highlighted roster agent (then Enter)</span>
          </div>
          <div className="shortcut-row">
            <kbd>?</kbd>
            <span>Toggle this shortcut panel</span>
          </div>
          <div className="shortcut-row">
            <kbd>Esc</kbd>
            <span>Close overlay/dialog, then deselect</span>
          </div>
        </div>
      </div>
    </div>
  );
}
