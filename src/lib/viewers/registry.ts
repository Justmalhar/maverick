import type { FileMeta, ViewerDescriptor, ViewerIntent } from "./types";

export class ViewerRegistry {
  private descriptors = new Map<string, ViewerDescriptor>();

  register(descriptor: ViewerDescriptor): void {
    if (this.descriptors.has(descriptor.id)) {
      throw new Error(`duplicate viewer id: ${descriptor.id}`);
    }
    this.descriptors.set(descriptor.id, descriptor);
  }

  get(id: string): ViewerDescriptor | undefined {
    return this.descriptors.get(id);
  }

  all(): ViewerDescriptor[] {
    return [...this.descriptors.values()];
  }

  /** Priority-ordered candidates; index 0 is the default, the rest feed "Open With…". */
  resolve(file: FileMeta, intent: ViewerIntent): ViewerDescriptor[] {
    return this.all()
      .filter((d) => d.canHandle(file, intent))
      .sort((a, b) => b.priority - a.priority);
  }
}

/** App-wide singleton; viewers self-register in src/lib/viewers/index.ts. */
export const viewerRegistry = new ViewerRegistry();
