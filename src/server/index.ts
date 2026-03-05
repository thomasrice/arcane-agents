import { bootstrap } from "./bootstrapApp";

export { bootstrap };

void bootstrap().catch((error: unknown) => {
  console.error("[arcane-agents] fatal startup error", error);
  process.exit(1);
});
