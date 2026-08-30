import { registerChatIpc } from "./chat.js";
import { registerAppIpc } from "./app.js";

export function registerIpc(): void {
  registerChatIpc();
  registerAppIpc();
}