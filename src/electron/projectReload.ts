export interface ProjectReloadActions {
  isDirty(): boolean;
  ask(): Promise<"cancel" | "save" | "discard">;
  save(): void;
  reload(): void;
}

// Saving returns to the editor: canceled/invalid saves must never trigger a reload.
export async function requestProjectReload(actions: ProjectReloadActions): Promise<void> {
  if (actions.isDirty()) {
    const choice = await actions.ask();
    if (choice === "cancel") return;
    if (choice === "save") { actions.save(); return; }
  }
  actions.reload();
}
