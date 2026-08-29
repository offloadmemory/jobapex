import { Box, Text } from "ink";

export interface HeaderProps {
  model: string;
  baseUrl: string;
  workspaceDir: string;
  memfs: boolean;
  yolo: boolean;
  threadId: string;
}

/** Startup banner as a bordered box — mirrors the readline banner. */
export function Header({ model, baseUrl, workspaceDir, memfs, yolo, threadId }: HeaderProps) {
  return (
    <Box borderStyle="round" flexDirection="column" paddingX={1}>
      <Text bold>✻ hermes</Text>
      <Text dimColor>model:      {model} (via {baseUrl})</Text>
      <Text dimColor>filesystem: {memfs ? "in-memory (virtual)" : workspaceDir}</Text>
      <Text dimColor>approvals:  {yolo || memfs ? "off" : "shell commands require your approval"}</Text>
      <Text dimColor>thread:     {threadId.slice(0, 8)}</Text>
      <Text dimColor>commands:   /todos /files /threads /resume /skills /memory /help /reset /exit</Text>
    </Box>
  );
}