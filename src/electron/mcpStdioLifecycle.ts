export function quitAfterMcpInputEnds(
  input: Pick<NodeJS.ReadableStream, "once">,
  closeServer: () => Promise<void>,
  quit: () => void,
  reportError: (error: unknown) => void,
): void {
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void closeServer().catch(reportError).finally(quit);
  };
  input.once("end", close);
  input.once("close", close);
}
