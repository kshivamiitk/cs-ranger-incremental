import type { StudySnapshot } from "../../../shared/types/study.js";
import type { StudyRepository } from "./persistence.js";
import type { StudyCommand } from "./commands.js";
import { applyCommand } from "./commands.js";
import { StudyError } from "./model.js";

export class StudyService {
  constructor(private readonly repository: StudyRepository, private readonly now = () => new Date()) {}
  async snapshot(userId: string): Promise<StudySnapshot> {
    const stored = await this.repository.load(userId);
    return { ...stored, storage: this.repository.mode, server_time: this.now().toISOString() };
  }
  async execute(userId: string, command: StudyCommand): Promise<StudySnapshot> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.repository.load(userId);
      const now = this.now();
      const workspace = applyCommand(current.workspace, command, now);
      if (workspace === current.workspace) {
        return { ...current, storage: this.repository.mode, server_time: now.toISOString() };
      }
      const version = await this.repository.save(userId, current.version, workspace);
      if (version !== null) {
        return { version, workspace, storage: this.repository.mode, server_time: now.toISOString() };
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
    }
    throw new StudyError("Your workspace changed in another tab. Reload and retry.", 409, "VERSION_CONFLICT");
  }
}
