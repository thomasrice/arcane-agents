import { useEffect, useState } from "react";
import { isElementInTerminalPanel } from "../app/utils";

export function useTerminalFocus(terminalWorkerId: string | undefined): boolean {
  const [terminalFocused, setTerminalFocused] = useState(false);

  useEffect(() => {
    if (!terminalWorkerId) {
      setTerminalFocused(false);
    }
  }, [terminalWorkerId]);

  useEffect(() => {
    const updateTerminalFocus = () => {
      setTerminalFocused(isElementInTerminalPanel(document.activeElement));
    };

    const handleFocusOut = () => {
      setTimeout(updateTerminalFocus, 0);
    };

    const handleWindowBlur = () => {
      setTerminalFocused(false);
    };

    window.addEventListener("focusin", updateTerminalFocus, true);
    window.addEventListener("focusout", handleFocusOut, true);
    window.addEventListener("blur", handleWindowBlur);

    updateTerminalFocus();

    return () => {
      window.removeEventListener("focusin", updateTerminalFocus, true);
      window.removeEventListener("focusout", handleFocusOut, true);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  return terminalFocused;
}
