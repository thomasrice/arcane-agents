interface TmuxConnectionOptions {
  socketName: string;
}

interface FriendlyTmuxDefaultsOptions {
  copyCommand?: string;
}

export function buildTmuxArgs(args: string[], options: TmuxConnectionOptions): string[] {
  return ["-L", options.socketName, ...args];
}

export function buildTmuxAttachArgs(target: string, options: TmuxConnectionOptions): string[] {
  return buildTmuxArgs(["attach-session", "-t", target], options);
}

export function buildTmuxCommandPrefix(options: TmuxConnectionOptions): string {
  return `tmux -L ${shellQuote(options.socketName)}`;
}

export function buildFriendlyTmuxDefaults(options: FriendlyTmuxDefaultsOptions = {}): string[][] {
  const copyAction = options.copyCommand ? "copy-pipe-and-cancel" : "copy-selection-and-cancel";
  const commands: string[][] = [
    ["set-option", "-g", "mouse", "on"],
    ["set-option", "-s", "escape-time", "0"],
    ["set-window-option", "-g", "history-limit", "100000"],
    ["bind-key", "-T", "copy-mode", "MouseDragEnd1Pane", "send-keys", "-X", copyAction],
    ["bind-key", "-T", "copy-mode-vi", "MouseDragEnd1Pane", "send-keys", "-X", copyAction]
  ];

  if (options.copyCommand) {
    commands.splice(
      3,
      0,
      ["set-option", "-s", "set-clipboard", "external"],
      ["set-option", "-s", "copy-command", options.copyCommand]
    );
  }

  return commands;
}

function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}
