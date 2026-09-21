/**
 * Live scripts write real state (thread rows, skills, notes, providers, a PIN
 * hash). Their npm scripts point HOME at a fresh temp dir so paths derived from
 * os.homedir() land there instead of the user's ~/.deepagents/hermes; running a
 * script bare would pollute the real app home, so refuse instead.
 */
export function requireIsolatedHome(): string {
  const home = process.env.HOME;
  if (!process.env.HERMES_TEST_HOME || !home) {
    throw new Error(
      "Run this script through its npm script (e.g. `npm run threads:test`) — it points HOME at a temp dir so your real agent state stays untouched."
    );
  }
  return home;
}
