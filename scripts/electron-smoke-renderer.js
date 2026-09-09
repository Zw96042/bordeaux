(async () => {
  const waitFor = async (predicate, label) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Smoke timed out waiting for ' + label);
  };
  await waitFor(() => document.querySelector('.pageswitch button'), 'initial editor');
  const unnamedOnPage = () => {
    const controls = [...document.querySelectorAll('button,input,select,textarea,[role="button"]')];
    const name = (el) => el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || el.labels?.[0]?.textContent || (el.matches('button,[role="button"]') ? el.textContent : '');
    return controls.filter((el) => !String(name(el) || '').trim()).map((el) => el.className);
  };
  const addMarker = async (fraction) => {
    document.activeElement?.blur();
    // Command edits can start a new preview and temporarily make the field inert.
    // Wait for the same interactive state before each native marker placement.
    await waitFor(() => {
      const field = document.querySelector('.stage-plan .fieldcol');
      return field && !field.inert && field.getAttribute('aria-disabled') !== 'true';
    }, 'interactive field before marker placement');
    const segment = document.querySelector('.fieldsvg path[data-role="seg"]');
    if (!segment) throw new Error('Smoke marker placement requires a visible path');
    const point = segment.getPointAtLength(segment.getTotalLength() * fraction).matrixTransform(segment.getScreenCTM());
    window.__bordeauxSmokeInput = { x: Math.round(point.x), y: Math.round(point.y) };
    for (let attempt = 0; attempt < 200; attempt++) {
      if (!window.__bordeauxSmokeInput) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Smoke marker pointer input was not delivered');
  };
  const unnamed = [...unnamedOnPage()];
  for (const page of ['Routines', 'Settings']) {
    [...document.querySelectorAll('.pageswitch button,.library-tabs button')].find((button) => button.textContent.trim() === page)?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    unnamed.push(...unnamedOnPage());
  }
  const project = { schemaVersion: '1.0', field: { id: '2026-rebuilt', revision: '2026-manual-tu19-welded-4', coordinateSchemaId: 'bordeaux-field/1.0' }, name: 'Smoke edited', robot: { drive: 'swerve', w: .8, l: .8, maxSpeed: 4 }, paths: [{ id: 'path_smoke', name: 'Smoke', waypoints: [{ x: 1, y: 1, theta: 0, thetaOn: true, linked: true, stop: false, prevC: { x: .8, y: 1 }, nextC: { x: 1.2, y: 1 } }, { x: 2, y: 1, theta: 0, thetaOn: true, linked: true, stop: false, prevC: { x: 1.8, y: 1 }, nextC: { x: 2.2, y: 1 } }], targets: [], markers: [{ id: 'event_smoke', f: .5, name: 'Smoke event', invocation: { commandId: 'frc.robot.SmokeCommand', arguments: { count: 2, sequence: '9007199254740993', tags: ['auto'] }, cancelOnPathEnd: true } }], ranges: [], constraints: { maxVel: 2, maxAccel: 2, maxDecel: 2, maxAngVel: 180, maxAngAccel: 360 }, startVel: 0, goalVel: 0 }], pathLinks: [], routines: [{ id: 'routine_smoke_active', name: 'Smoke routine', nodes: [{ id: 'routine_smoke', type: 'path', ref: 'path_smoke' }] }], activeRoutineId: 'routine_smoke_active', plannerId: 'profiledSpline' };
  await window.bordeauxAPI.saveProject(project, true);
  await waitFor(() => document.getElementById('robot-drive-motor'), 'robot settings');
  document.getElementById('robot-drive-motor').click();
  for (let attempt = 0; attempt < 50 && !document.querySelector('#robot-drive-motor-listbox [data-value="rev-neo"]'); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  document.querySelector('#robot-drive-motor-listbox [data-value="rev-neo"]')?.click();
  let motorAutosave;
  await waitFor(async () => {
    motorAutosave = await window.bordeauxAPI.restoreLastProject();
    return motorAutosave.project.robot.driveModel?.motorId === 'rev-neo';
  }, 'motor preset autosave');
  const motorPreset = motorAutosave.project.robot.driveModel?.motorId === 'rev-neo'
    && motorAutosave.project.robot.driveModel?.motorFreeRpm === 5676
    && motorAutosave.project.robot.maxSpeed > 4;
  const validation = await window.bordeauxAPI.validateProject(project);
  const robotConnection = await window.bordeauxAPI.linkRobotProject();
  const builtRobotConnection = await window.bordeauxAPI.buildRobotCatalog();
  const recentRobotProjects = await window.bordeauxAPI.listRecentRobotProjects();
  const reopenedRobotConnection = await window.bordeauxAPI.openRecentRobotProject(recentRobotProjects[0].id);
  const secondPath = structuredClone(project.paths[0]);
  secondPath.id = 'path_smoke_second'; secondPath.name = 'Smoke second';
  secondPath.markers = [];
  const persistedProject = { ...project, paths: [...project.paths, secondPath], editor: { activePathId: secondPath.id, robotProjectBookmarkId: recentRobotProjects[0].id } };
  [...document.querySelectorAll('.pageswitch button')].find((button) => button.textContent.trim() === 'Editor')?.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  [...document.querySelectorAll('.library-tabs button')].find((button) => button.textContent.trim() === 'Paths')?.click();
  for (let attempt = 0; attempt < 100; attempt++) {
    const planStage = document.querySelector('.stage-plan .fieldcol');
    if (planStage && planStage.getAttribute('aria-disabled') !== 'true') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  await addMarker(0.4);
  const findLinkButton = () => [...document.querySelectorAll('.ctxinsp button')]
    .find((button) => button.textContent.trim() === 'Choose LabVIEW project');
  await waitFor(findLinkButton, 'LabVIEW project link action');
  const linkButton = findLinkButton();
  linkButton.click();
  await waitFor(() => document.getElementById('event-marker-command')?.disabled === false, 'command search enabled');
  const commandPicker = document.getElementById('event-marker-command');
  const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const commandOptions = [...document.querySelectorAll('#event-marker-command-results [role="option"]')];
  const commandSearch = commandPicker;
  // The inline browser searches command labels and parameter metadata even in small catalogs.
  setInputValue.call(commandSearch, 'Smoke Count');
  commandSearch.dispatchEvent(new Event('input', { bubbles: true }));
  await waitFor(() => document.querySelectorAll('#event-marker-command-results [role="option"]').length === 1, 'command and parameter search');
  const smokeCommandOption = [...document.querySelectorAll('#event-marker-command-results [role="option"]')]
    .find((option) => option.querySelector('strong')?.textContent === 'Smoke Command');
  if (!smokeCommandOption) throw new Error('Smoke Command was not found by command and parameter search');
  smokeCommandOption.click();
  await waitFor(() => document.getElementById('event-command-param-tags'), 'selected command parameters');
  const jsonParameter = document.getElementById('event-command-param-tags');
  const exactIntegerParameter = document.getElementById('event-command-param-sequence');
  const smokeParametersPresent = Boolean(document.getElementById('event-command-param-count') && jsonParameter && exactIntegerParameter);
  const setTextAreaValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  if (jsonParameter) {
    setTextAreaValue.call(jsonParameter, '{}');
    jsonParameter.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    jsonParameter.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  await waitFor(() => jsonParameter?.getAttribute('aria-invalid') === 'true', 'invalid JSON parameter rejected');
  const jsonShapeRejected = jsonParameter?.getAttribute('aria-invalid') === 'true';
  if (jsonParameter) {
    setTextAreaValue.call(jsonParameter, '["auto"]');
    jsonParameter.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    jsonParameter.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  await waitFor(() => jsonParameter?.getAttribute('aria-invalid') === 'false', 'valid JSON parameter accepted');
  if (exactIntegerParameter) {
    setInputValue.call(exactIntegerParameter, '9223372036854775808');
    exactIntegerParameter.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    exactIntegerParameter.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  await waitFor(() => exactIntegerParameter?.getAttribute('aria-invalid') === 'true', 'out-of-range I64 rejected');
  const longRangeRejected = exactIntegerParameter?.getAttribute('aria-invalid') === 'true';
  if (exactIntegerParameter) {
    setInputValue.call(exactIntegerParameter, '9007199254740993');
    exactIntegerParameter.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    exactIntegerParameter.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }
  await waitFor(() => exactIntegerParameter?.getAttribute('aria-invalid') === 'false', 'exact I64 accepted');
  document.querySelector('.cmd-command-editor .choice-change')?.click();
  await waitFor(() => document.querySelector('#event-marker-command-results [role="option"]'), 'change command browser');
  const largeEnumCommandOption = [...document.querySelectorAll('#event-marker-command-results [role="option"]')]
    .find((option) => option.querySelector('strong')?.textContent === 'Choose Autonomous Mode');
  if (!largeEnumCommandOption) throw new Error('Large enum command was not available');
  largeEnumCommandOption.click();
  await waitFor(() => document.getElementById('event-command-param-mode'), 'large enum parameter');
  const largeEnumPicker = document.getElementById('event-command-param-mode');
  largeEnumPicker?.click();
  for (let attempt = 0; attempt < 50 && !document.querySelector('#event-command-param-mode-listbox [role="option"]'); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const largeEnumOptions = [...document.querySelectorAll('#event-command-param-mode-listbox [role="option"]')];
  const largeEnumOverflowNotice = document.querySelector('#event-command-param-mode-listbox .cmd-picker-more')?.textContent || '';
  const largeEnumSearch = document.getElementById('event-command-param-mode-search');
  if (largeEnumSearch) {
    setInputValue.call(largeEnumSearch, 'MODE_150');
    largeEnumSearch.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  for (let attempt = 0; attempt < 50 && !document.querySelector('#event-command-param-mode-listbox [data-value="MODE_150"]'); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const largeEnumChoice = [...document.querySelectorAll('#event-command-param-mode-listbox [role="option"]')]
    .find((option) => option.getAttribute('data-value') === 'MODE_150');
  largeEnumChoice?.click();
  for (let attempt = 0; attempt < 50 && document.getElementById('event-command-param-mode-value')?.textContent !== 'MODE_150'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const robotUi = {
    markerInspector: Boolean(document.querySelector('section[aria-label="Marker command"]') && document.querySelector('.labview-project-name')?.textContent.includes('SmokeRobot')),
    linkAction: Boolean(linkButton),
    commandEnabled: Boolean(commandPicker && !commandPicker.disabled),
    commandOptions: commandOptions.length,
    commandSearch: commandSearch?.getAttribute('role') === 'combobox',
    recentHiddenForSingleProject: !document.querySelector('.labview-recent-projects'),
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
  await waitFor(async () => {
    markerAutosave = await window.bordeauxAPI.restoreLastProject();
    return markerAutosave.project.paths[0].markers.length === 2;
  }, 'second event marker autosave');
  const eventMarkerAutosave = markerAutosave.project.paths[0].markers.length === 2
    && markerAutosave.project.paths[0].markers[1].name === 'event2';
  await window.bordeauxAPI.newProject();
  let missingTypeEvidenceRejected = false;
  try { await window.bordeauxAPI.exportBdx(persistedProject, persistedProject.paths[0].id); }
  catch (error) { missingTypeEvidenceRejected = /NI|catalog|command/i.test(String(error && error.message || error)); }
  await window.bordeauxAPI.openRecentRobotProject(recentRobotProjects[0].id);
  const eventless = structuredClone(persistedProject);
  for (const path of eventless.paths) path.markers = [];
  const exportedBdx = await window.bordeauxAPI.exportBdx(eventless, eventless.paths[0].id);
  const generated = await window.bordeauxAPI.saveProject(eventless, true);
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  const pushRoutineButton = [...document.querySelectorAll('.library-push button')].find((button) => button.textContent.trim() === 'Push routine');
  if (!pushRoutineButton) throw new Error('Routine push action was not available');
  pushRoutineButton.click();
  await waitFor(() => document.querySelector('[aria-labelledby="robot-file-title"]')?.open, 'robot file dialog');
  const robotPushDialog = document.querySelector('[aria-labelledby="robot-file-title"]');
  const routineDeliveryBlocked = robotPushDialog.textContent.includes('Routine delivery and full-project replacement are not supported');
  robotPushDialog.querySelector('[aria-label="Close robot files"]').click();
  [...document.querySelectorAll('.library-tabs button')].find(button => button.textContent.trim() === 'Paths').click();
  await waitFor(() => [...document.querySelectorAll('.library-push button')].some(button => button.textContent.trim() === 'Push path'), 'path push action');
  [...document.querySelectorAll('.library-push button')].find(button => button.textContent.trim() === 'Push path').click();
  await waitFor(() => document.querySelector('[aria-labelledby="robot-file-title"] input[placeholder="roborio-2468-frc.local"]'), 'SFTP connection fields');
  const robotPushUi = routineDeliveryBlocked && window.bordeauxAPI.robotDeliveryCapabilities.pathPush
    && [...document.querySelectorAll('[aria-labelledby="robot-file-title"] input')].some(input => input.value === '/natinst/bin/Paths')
    && !document.querySelector('[aria-labelledby="robot-file-title"]').textContent.includes('compatible LabVIEW BDX receiver');
  window.bordeauxAPI.setDirty(true);
  const probe = document.createElement('script'); probe.textContent = 'window.__bordeauxInlineScriptRan = true'; document.head.appendChild(probe);
  const editorRestored = opened.project.editor?.activePathId === secondPath.id && opened.project.editor?.robotProjectBookmarkId === recentRobotProjects[0].id;
  return { title: document.title, api: typeof window.bordeauxAPI?.saveProject === "function", root: Boolean(document.getElementById("root")?.children.length), fatalError: document.querySelector('.fatal-error')?.textContent || '', unnamed, main: document.querySelectorAll('main').length, nav: document.querySelectorAll('nav').length, validation: validation.ok, motorPreset, eventMarkerAutosave, multiRoutineUi, robotPushUi, robotDiscovery: robotConnection.catalog.projectName === 'SmokeRobot' && robotConnection.catalog.commands.some((command) => command.id === 'frc.robot.SmokeCommand'), robotBuilt: builtRobotConnection.catalog.authoritative === true && builtRobotConnection.catalog.catalogHash === reopenedRobotConnection.catalog.catalogHash, robotRecent: recentRobotProjects.length === 1 && reopenedRobotConnection.catalog.projectName === 'SmokeRobot', robotUi, missingTypeEvidenceRejected, folderBdxSaved: generated.saved && generated.bdxCount === eventless.paths.length && !generated.exportError, sourceSavedOnBdxFailure: saved.saved && Boolean(saved.exportError), eventlessBdxExported: exportedBdx.exported && exportedBdx.eventCount === 0, restored: restored.project.name === persistedProject.name, roundTrip: saved.saved && opened.project.name === persistedProject.name && opened.project.routines.find((routine) => routine.id === opened.project.activeRoutineId)?.nodes[0]?.ref === 'path_smoke' && !('routine' in opened.project), editorRestored, nodeGlobalsBlocked: typeof require === 'undefined', popupBlocked: window.open('https://example.com') === null, inlineScriptBlocked: !window.__bordeauxInlineScriptRan };
})();
