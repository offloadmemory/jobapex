import { Box, Text } from "ink";
import { useEffect, useState } from "react";

export interface LiveStreamProps {
  live: { thinking: string; text: string; depth: number } | null;
  /** True while a task is in flight — shows the spinner line. */
  streaming: boolean;
}

/** Braille dots frames — ink@7 has no built-in Spinner, so animate one. */
const DOTS = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function useSpinnerFrame(active: boolean): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setFrame((f) => f + 1), 80);
    return () => clearInterval(timer);
  }, [active]);
  return frame;
}

/** In-progress tokens: dim thinking block, plain answer text, and while
 * streaming a dots spinner + interrupt hint. */
export function LiveStream({ live, streaming }: LiveStreamProps) {
  const frame = useSpinnerFrame(streaming);
  if (!live && !streaming) return null;
  const indent = "  ".repeat(Math.min(live?.depth ?? 0, 2));
  return (
    <Box flexDirection="column" marginTop={1}>
      {live?.thinking ? <Text dimColor>{indent}🧠 {live.thinking}</Text> : null}
      {live?.text ? <Text>{indent}{live.text}</Text> : null}
      {streaming ? (
        <Text dimColor>{DOTS[frame % DOTS.length]} esc to interrupt</Text>
      ) : null}
    </Box>
  );
}