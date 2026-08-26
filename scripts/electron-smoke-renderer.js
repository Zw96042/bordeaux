  const largeEnumChoice = [...document.querySelectorAll('#event-command-param-mode-listbox [role="option"]')]
    .find((option) => option.getAttribute('data-value') === 'MODE_150');
  largeEnumChoice?.click();
  for (let attempt = 0; attempt < 50 && document.getElementById('event-command-param-mode-value')?.textContent !== 'MODE_150'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const javaUi = {
    markerInspector: Boolean(document.querySelector('.cmd-project')),
    linkAction: Boolean(linkButton),
    commandEnabled: Boolean(commandPicker && !commandPicker.disabled),
    commandOptions: commandOptions.length,
    searchHiddenForSmallCatalog: !commandSearch,
    recentHiddenForSingleProject: !document.getElementById('event-marker-java-project'),
    cancelSwitch: Boolean(document.getElementById('event-command-cancel') && document.querySelector('.cmd-toggle-track')),
    parameter: smokeParametersPresent,
    jsonShapeRejected,
    jsonShapeAccepted: jsonParameter?.getAttribute('aria-invalid') === 'false',
    longRangeRejected,
    exactInteger: exactIntegerParameter?.value === '9007199254740993' && exactIntegerParameter?.type === 'text',
    largeEnumDetails: { optionCount: largeEnumOptions.length, overflowNotice: largeEnumOverflowNotice, searchPresent: Boolean(largeEnumSearch), selectedValue: document.getElementById('event-command-param-mode-value')?.textContent, commandFound: Boolean(largeEnumCommandOption), pickerFound: Boolean(largeEnumPicker) },
    largeEnumPicker: largeEnumOptions.length === 80
      && largeEnumOverflowNotice.includes('80 of 160 shown')
      && Boolean(largeEnumSearch)
      && document.getElementById('event-command-param-mode-value')?.textContent === 'MODE_150',
    accessible: unnamedOnPage().length === 0,
  };
  await addMarker(0.65);
  let markerAutosave;
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    markerAutosave = await window.bordeauxAPI.restoreLastProject();
    if (markerAutosave.project.paths[0].markers.length === 2) break;
  }
  const eventMarkerAutosave = markerAutosave.project.paths[0].markers.length === 2
    && markerAutosave.project.paths[0].markers[1].name === 'event2';
  await window.bordeauxAPI.newProject();
  let staleJavaExportRejected = false;
  try { await window.bordeauxAPI.exportJava(persistedProject, 'linked'); }
  catch (error) { staleJavaExportRejected = String(error && error.message || error).includes('Link a Java robot project'); }
  await window.bordeauxAPI.openRecentJavaProject(recentJavaProjects[0].id);
  const javaExported = await window.bordeauxAPI.exportJava(persistedProject, 'linked');
  const saved = await window.bordeauxAPI.saveProject(persistedProject, true);
  const restored = await window.bordeauxAPI.restoreLastProject();
  await window.bordeauxAPI.newProject();
  const opened = await window.bordeauxAPI.openProject();
  [...document.querySelectorAll('.library-tabs button')].find((button) => button.textContent.trim() === 'Routines')?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const routineLibraryOpened = document.querySelector('.library-tabs [aria-selected="true"]')?.textContent === 'Routines';
  [...document.querySelectorAll('.library-tools button')].find((button) => button.textContent.trim() === 'New routine')?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const newRoutineSelected = document.querySelector('.library-current-name')?.textContent === 'New routine';
  document.querySelector('.library-rename')?.requestSubmit();
  await new Promise((resolve) => setTimeout(resolve, 0));
  document.querySelector('button[aria-label="Actions for New routine"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  [...document.querySelectorAll('.library-menu button')].find((button) => button.textContent.trim() === 'Duplicate')?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const routineDuplicateSelected = document.querySelector('.library-current-name')?.textContent === 'New routine copy';
  const multiRoutineUi = routineLibraryOpened && newRoutineSelected && routineDuplicateSelected;
  document.querySelector('.library-rename')?.requestSubmit();
  document.querySelector('.library-connection')?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const robotPushDialog = document.querySelector('[aria-labelledby="robot-push-title"]');
  const robotPushUi = Boolean(robotPushDialog
    && robotPushDialog.textContent.includes('Saving your project never sends robot data')
    && robotPushDialog.querySelector('input[placeholder="roborio-2468-frc.local"]')
    && robotPushDialog.querySelector('button[aria-label="Close robot connection"]'));
  window.bordeauxAPI.setDirty(true);
  const probe = document.createElement('script'); probe.textContent = 'window.__bordeauxInlineScriptRan = true'; document.head.appendChild(probe);
  const editorRestored = opened.project.editor?.activePathId === secondPath.id && opened.project.editor?.javaProjectBookmarkId === recentJavaProjects[0].id;
  return { title: document.title, api: typeof window.bordeauxAPI?.saveProject === "function", root: Boolean(document.getElementById("root")?.children.length), fatalError: document.querySelector('.fatal-error')?.textContent || '', unnamed, main: document.querySelectorAll('main').length, nav: document.querySelectorAll('nav').length, validation: validation.ok, motorPreset, eventMarkerAutosave, multiRoutineUi, robotPushUi, javaDiscovery: javaConnection.catalog.projectName === 'SmokeRobot' && javaConnection.catalog.commands.some((command) => command.id === 'frc.robot.SmokeCommand'), javaInstalled: installedJavaConnection.integration.installed, javaBuilt: builtJavaConnection.catalog.authoritative === true && builtJavaConnection.catalog.catalogHash === reopenedJavaConnection.catalog.catalogHash, javaRecent: recentJavaProjects.length === 1 && reopenedJavaConnection.catalog.projectName === 'SmokeRobot', javaUi, staleJavaExportRejected, javaExported: javaExported.exported && javaExported.eventCount === 1, restored: restored.project.name === persistedProject.name, roundTrip: saved.saved && opened.project.name === persistedProject.name && opened.project.routines.find((routine) => routine.id === opened.project.activeRoutineId)?.nodes[0]?.ref === 'path_smoke' && !('routine' in opened.project), editorRestored, nodeGlobalsBlocked: typeof require === 'undefined', popupBlocked: window.open('https://example.com') === null, inlineScriptBlocked: !window.__bordeauxInlineScriptRan };
})();
