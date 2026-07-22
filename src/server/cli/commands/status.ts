import { runLearnPrompt } from "../learnPrompt";

export async function runStatus(args: string[], sessionName: string | undefined): Promise<number> {
  const [subcommand, ...subcommandArgs] = args;
  if (subcommand === "learn-prompt") {
    if (subcommandArgs.length === 1 && (subcommandArgs[0] === "--help" || subcommandArgs[0] === "-h")) {
      printStatusHelp();
      return 0;
    }
    return runLearnPrompt(subcommandArgs, sessionName);
  }
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    printStatusHelp();
    return 0;
  }
  console.error(`[arcane-agents] unknown status command '${subcommand}'.`);
  printStatusHelp();
  return 1;
}

export function printStatusHelp(): void {
  console.log(`Usage:
  arcane-agents status learn-prompt <worker> [--runtime claude|codex|opencode|omp] [--id <id>] [--dry-run|--yes] [--json]

Commands:
  learn-prompt  Safely derive and save a structural idle-prompt signature from a live worker pane.

Options:
  --runtime <runtime>  Override runtime detection.
  --id <id>            Override the generated signature ID.
  --dry-run            Preview without writing.
  --yes                Write without confirmation.
  --json               Machine-readable output; requires --dry-run or --yes.`);
}
