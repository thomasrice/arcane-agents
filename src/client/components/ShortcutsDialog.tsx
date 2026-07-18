import { getHotkeyReference } from "../hotkeys/registry";

interface ShortcutsDialogProps {
  open: boolean;
  leaveTerminalFocusHotkeys: string[];
  onClose: () => void;
}

// Rendered entirely from the hotkey registry (plus the configured leave-terminal chord),
// so the on-screen reference can never drift from the actual bindings.
export function ShortcutsDialog({
  open,
  leaveTerminalFocusHotkeys,
  onClose
}: ShortcutsDialogProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  const sections = getHotkeyReference({ leaveTerminalFocusHotkeys });

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog shortcuts-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-title">Keyboard Shortcuts</div>
        {sections.map((section) =>
          section.rows.length === 0 ? null : (
            <div key={section.title} className="shortcut-section">
              <div className="shortcut-section-label">{section.title}</div>
              <div className="shortcut-grid">
                {section.rows.map((row) => (
                  <div key={`${row.keys}-${row.description}`} className="shortcut-row">
                    <kbd>{row.keys}</kbd>
                    <span>{row.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}
