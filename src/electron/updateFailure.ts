import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";

export const OFFICIAL_RELEASES_URL = "https://github.com/Zw96042/bordeaux/releases";

export function describeUpdateFailure(message: string): string {
  // Response bodies can contain entire proxy error pages. Use only the error
  // prefix for classification and keep the original message for Copy details.
  const diagnostic = message.split(/<!doctype\b|<html\b|<body\b/i, 1)[0];
  const signatureFailure = /signature|code requirement|codesign/i.test(diagnostic);
  const accessDenied = /\b403\b|\bforbidden\b/i.test(diagnostic);
  const networkFailure = /network|ENOTFOUND|ECONN|ETIMEDOUT|internet|timed? out/i.test(diagnostic);
  return signatureFailure
    ? "The downloaded update could not be verified. Save your work, then download an installer from the official Bordeaux releases page and replace the installed app manually."
    : accessDenied
      ? "The update request was denied (HTTP 403). GitHub or a network filter may be blocking the connection. Try again later or on another network, or open the official Bordeaux releases page to download an installer."
      : networkFailure
        ? "Check your internet connection and try Check for Updates again. You can also download an installer from the official Bordeaux releases page."
        : "Try Check for Updates again, or download an installer from the official Bordeaux releases page.";
}

export async function presentUpdateFailure(message: string, actions: {
  show(options: MessageBoxOptions): Promise<Pick<MessageBoxReturnValue, "response">>;
  copy(text: string): void;
  open(url: string): Promise<void>;
}): Promise<void> {
  const explanation = describeUpdateFailure(message);
  for (;;) {
    const { response } = await actions.show({
      type: "error", title: "Bordeaux update failed", message: "Bordeaux could not complete the update.",
      detail: explanation + "\n\nUse Copy details to share the complete error when asking for help.",
      buttons: ["Close", "Open releases", "Copy details"], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (response === 2) { actions.copy(message); continue; }
    if (response === 1) await actions.open(OFFICIAL_RELEASES_URL);
    return;
  }
}
