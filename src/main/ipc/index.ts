import { registerAppIpc } from "./app.js";
import { registerChatIpc } from "./chat.js";
import { registerFilesIpc } from "./files.js";
import { registerMemoryIpc } from "./memory.js";
import { registerProvidersIpc } from "./providers.js";
import { registerSkillsIpc } from "./skills.js";
import { registerThreadsIpc } from "./threads.js";

export function registerIpc(): void {
  registerChatIpc();
  registerAppIpc();
  registerThreadsIpc();
  registerSkillsIpc();
  registerMemoryIpc();
  registerProvidersIpc();
  registerFilesIpc();
}
