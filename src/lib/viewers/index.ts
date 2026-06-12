// Self-registration barrel: importing this module populates viewerRegistry.
// FileTabPane is the only consumer. Each viewer task appends its register() call.
import { viewerRegistry } from "./registry";

export { viewerRegistry };
