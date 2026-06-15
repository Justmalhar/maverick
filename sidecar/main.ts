import { runServer } from "./index";
import { repairToolPath } from "./deps";

// GUI-launched host apps inherit a minimal PATH; repair it before any subprocess
// (git, agent CLIs) is spawned so command lookup doesn't ENOENT.
repairToolPath();

await runServer();
