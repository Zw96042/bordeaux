const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const rendererHtml = process.env.BORDEAUX_BENCHMARK_RENDERER_HTML;
const label = process.env.BORDEAUX_BENCHMARK_LABEL || "renderer";
const latencySamples = Number.parseInt(process.env.BORDEAUX_BROWSER_LATENCY_SAMPLES || "24", 10);
const stressDurationMs = Number.parseInt(process.env.BORDEAUX_BROWSER_STRESS_MS || "2000", 10);
const inputHz = Number.parseInt(process.env.BORDEAUX_BROWSER_INPUT_HZ || "120", 10);
const checkCorrectness = process.env.BORDEAUX_BROWSER_CHECK_CORRECTNESS === "1";
const correctnessOnly = process.env.BORDEAUX_BROWSER_CORRECTNESS_ONLY === "1";
const forceDirectPreview = process.env.BORDEAUX_BENCHMARK_FORCE_DIRECT === "1";
const requireWorkerTransport = process.env.BORDEAUX_BENCHMARK_REQUIRE_WORKER_TRANSPORT === "1";
const mainClockOffsetMs = Number.parseFloat(process.env.BORDEAUX_BENCHMARK_MAIN_CLOCK_OFFSET_MS || "0");
const frameBudgetMs = 1000 / 60;
const primaryPath = { id: "browser_benchmark_path", name: "100-waypoint browser benchmark" };
const alternatePath = { id: "browser_benchmark_alternate", name: "Alternate benchmark path" };
const reopenedProjectName = "Reopened renderer browser benchmark";

if (!rendererHtml) throw new Error("BORDEAUX_BENCHMARK_RENDERER_HTML is required");

app.commandLine.appendSwitch("no-sandbox");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const epochNow = () => performance.timeOrigin + performance.now();
const stressMainNow = () => epochNow() + mainClockOffsetMs;

function percentile(values, fraction) {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function statistics(values) {
  return {
    count: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function frameSummary(frameDeltas) {
  let droppedFrames = 0;
  let expectedFrames = 0;
  for (const delta of frameDeltas) {
    const occupiedSlots = Math.max(1, Math.round(delta / frameBudgetMs));
    droppedFrames += occupiedSlots - 1;
    expectedFrames += occupiedSlots;
  }
  return {
    frameTimeMs: statistics(frameDeltas),
    droppedFrames,
    expectedFrames,
    droppedFramePercent: expectedFrames ? droppedFrames / expectedFrames * 100 : 0,
  };
}

function matchesBitmapColor(bitmap, offset, color, tolerance = 10) {
  const first = Math.abs(bitmap[offset] - color[0]) <= tolerance
    && Math.abs(bitmap[offset + 1] - color[1]) <= tolerance
    && Math.abs(bitmap[offset + 2] - color[2]) <= tolerance;
  const swapped = Math.abs(bitmap[offset] - color[2]) <= tolerance
    && Math.abs(bitmap[offset + 1] - color[1]) <= tolerance
    && Math.abs(bitmap[offset + 2] - color[0]) <= tolerance;
  return (first || swapped) && bitmap[offset + 3] >= 240;
}

function countBitmapColor(bitmap, size, center, color, minimumRadius, maximumRadius) {
  let count = 0;
  const minX = Math.max(0, Math.floor(center.x - maximumRadius));
  const maxX = Math.min(size.width - 1, Math.ceil(center.x + maximumRadius));
  const minY = Math.max(0, Math.floor(center.y - maximumRadius));
  const maxY = Math.min(size.height - 1, Math.ceil(center.y + maximumRadius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const radius = Math.hypot(x - center.x, y - center.y);
      if (radius < minimumRadius || radius > maximumRadius) continue;
      if (matchesBitmapColor(bitmap, (y * size.width + x) * 4, color)) count += 1;
    }
  }
  return count;
}

function containsPaintedGeometry(image, viewport, proof) {
  const size = image.getSize();
  if (!size.width || !size.height) return false;
  const bitmap = image.toBitmap();
  const center = { x: proof.target.x * size.width / viewport.width, y: proof.target.y * size.height / viewport.height };
  const scale = (size.width / viewport.width + size.height / viewport.height) / 2;
  const waypointPixels = countBitmapColor(bitmap, size, center, proof.token.waypoint, 0, 4 * scale);
  const curvePixels = countBitmapColor(bitmap, size, center, proof.token.curve, 7 * scale, 28 * scale);
  return waypointPixels >= 3 && curvePixels >= 3;
}

async function waitFor(predicate, timeoutMs, description) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await delay(16);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function installProbe(waypointIndex) {
  window.confirm = () => true;
  const rendererNow = () => performance.now();
  const epoch = () => performance.timeOrigin + performance.now();
  const state = {
    active: false,
    frames: [],
    geometry: [],
    inputStartedAt: null,
    inputEndedAt: null,
    lastGeometry: null,
    pending: null,
    lastCorrect: null,
    transport: [],
    transportSummaries: [],
    workerTransportProofs: 0,
    transportProofActive: false,
    trace: null,
    traceAfterRelease: 0,
    armedPaintToken: null,
    taggedGeometry: null,
    tokenSequence: 0,
  };
  const waypoint = () => document.querySelector(`[data-role="wp"][data-idx="${waypointIndex}"]`);
  const benchmarkSvg = waypoint()?.ownerSVGElement;
  const benchmarkInverse = benchmarkSvg?.getScreenCTM()?.inverse();
  const worldToSvg = (point) => point && ({
    x: 397 + point.x * (3502 - 397) / 17.548,
    y: 1486 - point.y * (1486 - 97) / 8.052,
  });
  const localAt = (x, y) => {
    if (!benchmarkSvg || !benchmarkInverse) return null;
    const point = benchmarkSvg.createSVGPoint();
    point.x = x;
    point.y = y;
    const local = point.matrixTransform(benchmarkInverse);
    return { x: local.x, y: local.y };
  };
  const inspect = () => {
    const node = waypoint();
    const svg = node?.ownerSVGElement;
    if (!node || !svg) return null;
    const rect = node.getBoundingClientRect();
    const screen = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const point = svg.createSVGPoint();
    point.x = Number(node.getAttribute("x")) + Number(node.getAttribute("width")) / 2;
    point.y = Number(node.getAttribute("y")) + Number(node.getAttribute("height")) / 2;
    const centerlines = [...svg.querySelectorAll("path")].filter((candidate) =>
      candidate.getAttribute("stroke") === "#05060a" && candidate.getAttribute("stroke-opacity") === "0.75");
    const curve = centerlines.find((candidate) =>
      typeof candidate.isPointInStroke === "function" && candidate.isPointInStroke(point));
    return { node, curve, value: { ...screen, localX: point.x, localY: point.y, curveCorrect: Boolean(curve) } };
  };
  const read = () => inspect()?.value || null;
  const clearPaintToken = () => {
    const tagged = state.taggedGeometry;
    if (!tagged) return;
    tagged.node.style.removeProperty('fill');
    tagged.node.style.removeProperty('stroke');
    tagged.curve.style.removeProperty('stroke');
    tagged.curve.style.removeProperty('stroke-opacity');
    state.taggedGeometry = null;
  };
  const colorFor = (sequence, offset) => {
    const salt = offset === 1 ? 0x35a7bd : 0xc8642e;
    const packed = ((((sequence * 0x9e3779) >>> 0) ^ salt) & 0xffffff) >>> 0;
    return [(packed >>> 16) & 0xff, (packed >>> 8) & 0xff, packed & 0xff];
  };
  const applyPaintToken = (geometry, token) => {
    clearPaintToken();
    const waypointColor = `rgb(${token.waypoint.join(' ')})`;
    const curveColor = `rgb(${token.curve.join(' ')})`;
    geometry.node.style.setProperty('fill', waypointColor);
    geometry.node.style.setProperty('stroke', waypointColor);
    geometry.curve.style.setProperty('stroke', curveColor);
    geometry.curve.style.setProperty('stroke-opacity', '1');
    state.taggedGeometry = { node: geometry.node, curve: geometry.curve };
  };
  window.addEventListener('bordeaux-benchmark:path-preview-transport', (event) => {
    if (event.detail?.phase === 'summary') state.transportSummaries.push(event.detail);
    else state.transport.push({ ...event.detail, atRendererMs: rendererNow() });
  });
  window.addEventListener("pointermove", (event) => {
    const receivedAtRendererMs = rendererNow();
    const local = localAt(event.clientX, event.clientY);
    state.pending = {
      x: event.clientX,
      y: event.clientY,
      localX: local?.x,
      localY: local?.y,
      inputAtEpochMs: epoch(),
      inputAtRendererMs: receivedAtRendererMs,
      transportStartIndex: state.transport.length,
      paintToken: state.armedPaintToken,
    };
    state.armedPaintToken = null;
    if (state.active) {
      if (state.inputStartedAt === null) state.inputStartedAt = receivedAtRendererMs;
      state.inputEndedAt = receivedAtRendererMs;
    }
  }, true);
  window.addEventListener("pointerup", () => { if (state.trace) state.traceAfterRelease = epoch(); }, true);
  const tick = (timestamp) => {
    const geometry = inspect();
    const current = geometry?.value || null;
    if (state.active) {
      state.frames.push(rendererNow());
      if (current?.curveCorrect && (!state.lastGeometry
        || Math.hypot(current.localX - state.lastGeometry.localX, current.localY - state.lastGeometry.localY) > 0.75)) {
        state.geometry.push(rendererNow());
        state.lastGeometry = current;
      }
    }
    if (state.trace && state.traceAfterRelease && current) state.trace.push({ atEpochMs: epoch(), x: current.x, y: current.y, curveCorrect: current.curveCorrect });
    if (state.pending && current?.curveCorrect
      && Math.hypot(current.x - state.pending.x, current.y - state.pending.y) <= 2.5
      && Math.hypot(current.localX - state.pending.localX, current.localY - state.pending.localY) <= 7) {
      const matchingResult = state.transport.slice(state.pending.transportStartIndex).findLast((entry) => {
        if (entry.phase !== 'result' || entry.quality !== 'interactive' || !entry.waypoint) return false;
        const expected = worldToSvg(entry.waypoint);
        return Math.hypot(current.localX - expected.x, current.localY - expected.y) <= 1;
      });
      const workerTransport = matchingResult?.source === 'worker'
        && state.transport.slice(state.pending.transportStartIndex).some((entry) => entry.phase === 'request'
          && entry.source === 'worker'
          && entry.schedulerId === matchingResult.schedulerId
          && entry.revision === matchingResult.revision);
      const transportResolved = workerTransport || matchingResult?.source === 'direct';
      if (state.transportProofActive && !transportResolved) {
        requestAnimationFrame(tick);
        return;
      }
      if (state.transportProofActive) {
        state.transportProofActive = false;
        if (workerTransport) state.workerTransportProofs += 1;
        window.dispatchEvent(new CustomEvent('bordeaux-benchmark:path-preview-transport-control', { detail: { mode: 'stop' } }));
      }
      if (state.pending.paintToken && geometry?.curve) applyPaintToken(geometry, state.pending.paintToken);
      state.lastCorrect = {
        ...state.pending,
        correctAtEpochMs: epoch(),
        workerTransport,
        transportSource: matchingResult?.source || null,
        transportRevision: matchingResult?.revision || null,
      };
      state.pending = null;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__rendererBenchmark = {
    read,
    localAt,
    lastCorrect: () => state.lastCorrect,
    start() {
      const current = read();
      state.active = true;
      state.frames = [];
      state.geometry = [];
      state.inputStartedAt = null;
      state.inputEndedAt = null;
      state.lastGeometry = current;
    },
    stop() {
      state.active = false;
      return {
        frames: state.frames,
        geometry: state.geometry,
        inputBoundsRendererMs: { startedAt: state.inputStartedAt, endedAt: state.inputEndedAt },
        workerTransportProofs: state.workerTransportProofs,
      };
    },
    armPaintToken() {
      const clearedPrevious = Boolean(state.taggedGeometry);
      clearPaintToken();
      const sequence = ++state.tokenSequence;
      const token = { id: sequence, waypoint: colorFor(sequence, 1), curve: colorFor(sequence, 2), clearedPrevious };
      state.armedPaintToken = token;
      return token;
    },
    clearPaintToken,
    startTransportProof() {
      state.transportProofActive = true;
      window.dispatchEvent(new CustomEvent('bordeaux-benchmark:path-preview-transport-control', {
        detail: { mode: 'proof' },
      }));
    },
    startTimedTransport(windowId) {
      state.transportSummaries = state.transportSummaries.filter((summary) => summary.windowId !== windowId);
      window.dispatchEvent(new CustomEvent('bordeaux-benchmark:path-preview-transport-control', {
        detail: { mode: 'timed-start', windowId },
      }));
    },
    finishTimedTransport(windowId) {
      window.dispatchEvent(new CustomEvent('bordeaux-benchmark:path-preview-transport-control', {
        detail: { mode: 'timed-report', windowId },
      }));
      const summaries = state.transportSummaries.filter((summary) => summary.windowId === windowId);
      return summaries.reduce((total, summary) => ({
        interactiveWorkerRequests: total.interactiveWorkerRequests + summary.interactiveWorkerRequests,
        matchingWorkerResults: total.matchingWorkerResults + summary.matchingWorkerResults,
        directResults: total.directResults + summary.directResults,
      }), { interactiveWorkerRequests: 0, matchingWorkerResults: 0, directResults: 0 });
    },
    startTrace() { state.trace = []; state.traceAfterRelease = 0; },
    stopTrace() { const trace = state.trace || []; state.trace = null; return trace; },
  };
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    useContentSize: true,
    backgroundColor: "#000000",
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      offscreen: true,
      preload: path.join(__dirname, "renderer-browser-benchmark-preload.cjs"),
      sandbox: false,
    },
  });
  window.webContents.setFrameRate(60);
  const loadRenderer = () => window.loadFile(rendererHtml, { query: {
    bordeauxBenchmarkTransport: forceDirectPreview ? "force-direct" : "observe",
    bordeauxBenchmarkWaypoint: "50",
  } });

  const paintTimestamps = [];
  const paintWaiters = new Set();
  const geometryPaintWaiters = new Set();
  let lastPaintAt = epochNow();
  window.webContents.on("paint", (_event, _dirtyRect, image) => {
    const timestamp = epochNow();
    lastPaintAt = timestamp;
    paintTimestamps.push(timestamp);
    for (const waiter of paintWaiters) {
      if (timestamp < waiter.after) continue;
      paintWaiters.delete(waiter);
      clearTimeout(waiter.timeout);
      waiter.resolve(timestamp);
    }
    const viewport = window.getContentSize();
    for (const waiter of geometryPaintWaiters) {
      if (timestamp < waiter.after || !containsPaintedGeometry(image, { width: viewport[0], height: viewport[1] }, waiter.proof)) continue;
      geometryPaintWaiters.delete(waiter);
      clearTimeout(waiter.timeout);
      waiter.resolve(timestamp);
    }
  });
  window.webContents.on("console-message", (details) => {
    if (details.level === "error" && !details.message.startsWith("Loading the font 'data:font/woff2")) {
      process.stderr.write(`[${label} renderer] ${details.message}\n`);
    }
  });

  function paintAfter(after, timeoutMs = 4000) {
    const recorded = paintTimestamps.find((timestamp) => timestamp >= after);
    if (recorded) return Promise.resolve(recorded);
    return new Promise((resolve, reject) => {
      const waiter = {
        after,
        resolve,
        timeout: setTimeout(() => {
          paintWaiters.delete(waiter);
          reject(new Error(`Timed out waiting for a paint after ${after.toFixed(3)}ms`));
        }, timeoutMs),
      };
      paintWaiters.add(waiter);
    });
  }

  function paintedGeometryAfter(after, proof, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const waiter = {
        after,
        proof,
        resolve,
        timeout: setTimeout(() => {
          geometryPaintWaiters.delete(waiter);
          reject(new Error(`Timed out waiting for painted geometry token ${proof.token.id}`));
        }, timeoutMs),
      };
      geometryPaintWaiters.add(waiter);
    });
  }

  async function waitForPaintQuiet(quietMs = 70, timeoutMs = 4000) {
    await waitFor(() => epochNow() - lastPaintAt >= quietMs, timeoutMs, "a quiet paint interval");
  }

  async function loadFixture() {
    const load = () => new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out loading ${rendererHtml}`)), 10000);
      loadRenderer().then(
        (value) => { clearTimeout(timeout); resolve(value); },
        (error) => { clearTimeout(timeout); reject(error); },
      );
    });
    try {
      await load();
    } catch (error) {
      await delay(100);
      try {
        await load();
      } catch {
        throw error;
      }
    }
    await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkReleaseRestore()");
    await waitFor(
      () => window.webContents.executeJavaScript('document.querySelectorAll(\'[data-role="wp"]\').length === 100'),
      10000,
      "the 100-waypoint fixture",
    );
    await window.webContents.executeJavaScript(`(${installProbe.toString()})(50)`);
    await waitForPaintQuiet(100);
  }

  const readProbe = () => window.webContents.executeJavaScript("window.__rendererBenchmark.read()");
  const center = async () => {
    const point = await readProbe();
    if (!point) throw new Error("Benchmark waypoint 50 is missing");
    return { x: Math.round(point.x), y: Math.round(point.y), localX: point.localX, localY: point.localY };
  };
  const moveMouse = (point) => window.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(point.x), y: Math.round(point.y), button: "left" });
  const pressMouse = async (point) => {
    moveMouse(point);
    await delay(16);
    window.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
  };
  const releaseMouse = (point) => window.webContents.sendInputEvent({ type: "mouseUp", x: Math.round(point.x), y: Math.round(point.y), button: "left", clickCount: 1 });
  const localAt = (target) => window.webContents.executeJavaScript(`window.__rendererBenchmark.localAt(${target.x}, ${target.y})`);
  const matchesTarget = (current, target, expectedLocal) => current?.curveCorrect
    && Math.hypot(current.x - target.x, current.y - target.y) <= 2.5
    && (!expectedLocal || Math.hypot(current.localX - expectedLocal.x, current.localY - expectedLocal.y) <= 7);
  const waitForCorrect = (target, expectedLocal, timeoutMs = 5000) => waitFor(
    async () => {
      const current = await readProbe();
      return matchesTarget(current, target, expectedLocal) ? current : null;
    },
    timeoutMs,
    `correct curve geometry at ${target.x},${target.y}`,
  );
  const proveApplicationWorkerTransport = async (origin) => {
    const target = { x: origin.x + 24, y: origin.y - 9 };
    const expectedLocal = await localAt(target);
    if (requireWorkerTransport) await window.webContents.executeJavaScript("window.__rendererBenchmark.startTransportProof()");
    moveMouse(target);
    await waitForCorrect(target, expectedLocal);
    const correct = await waitFor(async () => {
      const value = await window.webContents.executeJavaScript("window.__rendererBenchmark.lastCorrect()");
      return value && Math.hypot(value.x - target.x, value.y - target.y) <= 1 ? value : null;
    }, 5000, "the discarded application worker preflight");
    if (!requireWorkerTransport) return null;
    await window.webContents.executeJavaScript("window.dispatchEvent(new CustomEvent('bordeaux-benchmark:path-preview-transport-control', { detail: { mode: 'stop' } }))");
    return correct.workerTransport === true;
  };

  async function correctnessChecks() {
    await loadRenderer();
    await waitFor(
      () => window.webContents.executeJavaScript('document.querySelectorAll(\'[data-role="wp"]\').length > 0'),
      3000,
      "the initial unsaved project",
    );
    await window.webContents.executeJavaScript(`(${installProbe.toString()})(0)`);
    const restoreOrigin = await center();
    const restoreTarget = { x: restoreOrigin.x + 32, y: restoreOrigin.y - 14 };
    await pressMouse(restoreOrigin);
    const restoreTargetLocal = await localAt(restoreTarget);
    moveMouse(restoreTarget);
    await waitForCorrect(restoreTarget, restoreTargetLocal);
    await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkReleaseRestore()");
    const restoreConflictState = await waitFor(async () => {
      const state = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
      return state.projectOperations.some((entry) => entry === "restore:finish:original")
        && state.currentFile === null && state.mainDirty === true ? state : null;
    }, 4000, "the delayed restore conflict to detach its file");
    const restoreConflictStaysDirty = restoreConflictState.mainDirty === true;
    releaseMouse(restoreTarget);

    await loadFixture();
    const workerFixture = JSON.parse(Buffer.from(process.env.BORDEAUX_BENCHMARK_PROJECT, "base64").toString("utf8"));
    const publishedSession = await waitFor(async () => {
      const state = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
      return state.publishedSessions.at(-1) || null;
    }, 3000, "the renderer agent session to publish");
    const proposalPath = structuredClone(workerFixture.paths[1]);
    proposalPath.id = "browser_benchmark_agent_path";
    const proposal = {
      id: "browser_benchmark_agent_proposal",
      status: "ready",
      operation: "add",
      intent: "Add the benchmark path",
      baseSessionId: publishedSession.sessionId,
      baseRevision: publishedSession.revision,
      baseActivePathId: publishedSession.activePathId,
      candidates: [{ id: "browser_benchmark_agent_candidate", label: "Benchmark candidate", valid: true, path: proposalPath }],
      recommendedCandidateId: "browser_benchmark_agent_candidate",
      createdAt: new Date().toISOString(),
    };
    await window.webContents.executeJavaScript(`window.bordeauxAPI.__benchmarkAgentProposal(${JSON.stringify(proposal)})`);
    await waitFor(
      () => window.webContents.executeJavaScript("document.querySelector('.agent-proposal button.primary')?.textContent === 'Add path'"),
      3000,
      "the current agent proposal",
    );
    const proposalDragOrigin = await center();
    const proposalDragTarget = { x: proposalDragOrigin.x + 30, y: proposalDragOrigin.y - 12 };
    await pressMouse(proposalDragOrigin);
    const proposalDragLocal = await localAt(proposalDragTarget);
    moveMouse(proposalDragTarget);
    await waitForCorrect(proposalDragTarget, proposalDragLocal);
    const staleProposalState = await waitFor(async () => {
      const state = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
      const staleInUi = await window.webContents.executeJavaScript("document.querySelector('.agent-proposal-status')?.textContent.startsWith('Stale') === true");
      return staleInUi && state.proposalStatuses.some((entry) => entry.id === proposal.id && entry.status === "stale") ? state : null;
    }, 1000, "an agent proposal to become stale during a drag");
    await window.webContents.executeJavaScript("document.querySelector('.agent-proposal button.primary')?.click()");
    const proposalSaveCount = staleProposalState.savedProjects.length;
    releaseMouse(proposalDragTarget);
    await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkCommand('save-project')");
    const proposalAfterApply = await waitFor(async () => {
      const state = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
      return state.savedProjects.length > proposalSaveCount ? state : null;
    }, 3000, "the project after the stale proposal apply attempt");
    const proposalStatuses = proposalAfterApply.proposalStatuses.filter((entry) => entry.id === proposal.id);
    const staleProposalBlockedDuringDrag = proposalStatuses.some((entry) => entry.status === "stale")
      && !proposalStatuses.some((entry) => entry.status === "applied")
      && proposalAfterApply.savedProjects.at(-1).paths.length === 2;

    await loadFixture();
    const origin = await center();
    const lastMove = { x: origin.x + 42, y: origin.y - 16 };
    const release = { x: lastMove.x + 28, y: lastMove.y + 10 };
    await pressMouse(origin);
    const lastMoveLocal = await localAt(lastMove);
    const releaseLocal = await localAt(release);
    await window.webContents.executeJavaScript("window.__rendererBenchmark.startTransportProof()");
    const correctnessPaintToken = await window.webContents.executeJavaScript("window.__rendererBenchmark.armPaintToken()");
    const correctnessPaintStartedAt = epochNow();
    const correctnessPaint = paintedGeometryAfter(correctnessPaintStartedAt, { target: lastMove, token: correctnessPaintToken });
    moveMouse(lastMove);
    await waitForCorrect(lastMove, lastMoveLocal);
    const correctnessTransport = await waitFor(async () => {
      const value = await window.webContents.executeJavaScript("window.__rendererBenchmark.lastCorrect()");
      return value && Math.hypot(value.x - lastMove.x, value.y - lastMove.y) <= 1
        && (value.workerTransport === true || value.transportSource === 'direct') ? value : null;
    }, 5000, "the correctness application's preview transport");
    const applicationWorkerTransport = correctnessTransport?.workerTransport === true;
    const correctnessPaintAt = await correctnessPaint;
    const nativeImagePaintProof = correctnessPaintAt >= correctnessPaintStartedAt;
    await window.webContents.executeJavaScript("window.__rendererBenchmark.startTrace()");
    releaseMouse(release);
    await waitForCorrect(release, releaseLocal);
    await delay(500);
    const releaseFinal = await readProbe();
    const trace = await window.webContents.executeJavaScript("window.__rendererBenchmark.stopTrace()");
    const releaseStable = trace.length > 0 && trace.every((point) => point.curveCorrect
      && Math.hypot(point.x - release.x, point.y - release.y) <= 4);

    await loadFixture();
    const saveOrigin = await center();
    const saveTarget = { x: saveOrigin.x + 55, y: saveOrigin.y + 18 };
    await pressMouse(saveOrigin);
    const saveTargetLocal = await localAt(saveTarget);
    moveMouse(saveTarget);
    await waitForCorrect(saveTarget, saveTargetLocal);
    const closeGuardDirty = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState().mainDirty === true");
    await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkCommand('save-project')");
    const savedState = await waitFor(async () => {
      const state = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
      return state.savedProjects.length ? state : null;
    }, 3000, "an active edit to be saved");
    releaseMouse(saveTarget);
    const savedWaypoint = savedState.savedProjects.at(-1).paths[0].waypoints[50];
    const originalWaypoint = JSON.parse(Buffer.from(process.env.BORDEAUX_BENCHMARK_PROJECT, "base64").toString("utf8")).paths[0].waypoints[50];
    const saveIncludesDraft = Math.hypot(savedWaypoint.x - originalWaypoint.x, savedWaypoint.y - originalWaypoint.y) > 0.02;

    await loadFixture();
    const undoOrigin = await center();
    const undoTarget = { x: undoOrigin.x - 48, y: undoOrigin.y + 22 };
    await pressMouse(undoOrigin);
    const undoTargetLocal = await localAt(undoTarget);
    moveMouse(undoTarget);
    await waitForCorrect(undoTarget, undoTargetLocal);
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Z", modifiers: ["control"] });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Z", modifiers: ["control"] });
    await waitForCorrect(undoOrigin, { x: undoOrigin.localX, y: undoOrigin.localY });
    releaseMouse(undoTarget);
    await delay(150);
    const afterUndoRelease = await readProbe();
    const undoCancelsDrag = matchesTarget(afterUndoRelease, undoOrigin, { x: undoOrigin.localX, y: undoOrigin.localY });

    await loadFixture();
    const cancelPublishedSession = await waitFor(async () => {
      const state = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
      return state.publishedSessions.at(-1) || null;
    }, 3000, "the pre-cancel agent session to publish");
    const cancelPublishedSessionCount = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState().publishedSessions.length");
    const cancelOrigin = await center();
    const cancelTarget = { x: cancelOrigin.x + 44, y: cancelOrigin.y - 20 };
    const originalProject = JSON.parse(Buffer.from(process.env.BORDEAUX_BENCHMARK_PROJECT, "base64").toString("utf8"));
    const originalCancelWaypoint = originalProject.paths[0].waypoints[50];
    await pressMouse(cancelOrigin);
    const cancelTargetLocal = await localAt(cancelTarget);
    moveMouse(cancelTarget);
    await waitForCorrect(cancelTarget, cancelTargetLocal);
    await waitFor(async () => {
      const state = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
      const waypoint = state.autosavedProjects.at(-1)?.paths[0]?.waypoints[50];
      return waypoint && Math.hypot(waypoint.x - originalCancelWaypoint.x, waypoint.y - originalCancelWaypoint.y) > 0.02;
    }, 4000, "the active draft to be autosaved");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Z", modifiers: ["control"] });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Z", modifiers: ["control"] });
    await waitForCorrect(cancelOrigin, { x: cancelOrigin.localX, y: cancelOrigin.localY });
    releaseMouse(cancelTarget);
    const restoredAutosave = await waitFor(async () => {
      const state = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
      const waypoint = state.autosavedProjects.at(-1)?.paths[0]?.waypoints[50];
      return waypoint && Math.hypot(waypoint.x - originalCancelWaypoint.x, waypoint.y - originalCancelWaypoint.y) <= 1e-6
        ? state.autosavedProjects.at(-1)
        : null;
    }, 500, "the canceled draft autosave to be rolled back immediately");
    const cancelAutosaveRestored = Boolean(restoredAutosave);
    const cancelRepublishedSession = await waitFor(async () => {
      const state = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
      const latest = state.publishedSessions.at(-1);
      return state.publishedSessions.length > cancelPublishedSessionCount && latest.revision > cancelPublishedSession.revision ? latest : null;
    }, 3000, "the agent session to republish after canceling the drag");
    const postCancelProposal = {
      ...proposal,
      id: "browser_benchmark_post_cancel_proposal",
      baseSessionId: cancelRepublishedSession.sessionId,
      baseRevision: cancelRepublishedSession.revision,
      baseActivePathId: cancelRepublishedSession.activePathId,
      candidates: proposal.candidates.map((candidate) => ({ ...candidate, id: "browser_benchmark_post_cancel_candidate" })),
      recommendedCandidateId: "browser_benchmark_post_cancel_candidate",
    };
    await window.webContents.executeJavaScript(`window.bordeauxAPI.__benchmarkAgentProposal(${JSON.stringify(postCancelProposal)})`);
    await waitFor(
      () => window.webContents.executeJavaScript("document.querySelector('.agent-proposal-status')?.textContent.startsWith('Preview only') === true && document.querySelector('.agent-proposal button.primary')?.disabled === false"),
      3000,
      "the exact post-cancel proposal preview to become ready",
    );
    await window.webContents.executeJavaScript("document.querySelector('.agent-proposal button.primary')?.click()");
    const proposalUsableAfterCancel = Boolean(await waitFor(async () => {
      const state = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
      return state.proposalStatuses.some((entry) => entry.id === postCancelProposal.id && entry.status === "applied") ? state : null;
    }, 1000, "the post-cancel proposal to apply"));

    await loadFixture();
    const commandOrigin = await center();
    const commandTarget = { x: commandOrigin.x - 52, y: commandOrigin.y + 18 };
    const originalCommandWaypoint = originalProject.paths[0].waypoints[50];
    const expectedNudgeX = originalCommandWaypoint.x + 0.05;
    const saveWaypoint = async () => {
      const before = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState().savedProjects.length");
      await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkCommand('save-project')");
      const state = await waitFor(async () => {
        const next = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
        return next.savedProjects.length > before ? next : null;
      }, 3000, "the command-race project to be saved");
      return state.savedProjects.at(-1).paths[0].waypoints[50];
    };
    const pressKey = (keyCode, modifiers = []) => {
      window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    };
    await pressMouse(commandOrigin);
    const commandTargetLocal = await localAt(commandTarget);
    moveMouse(commandTarget);
    await waitForCorrect(commandTarget, commandTargetLocal);
    pressKey("Right");
    releaseMouse(commandTarget);
    await delay(150);
    const commandWaypoint = await saveWaypoint();
    const commandSurvivesDrag = Math.abs(commandWaypoint.x - expectedNudgeX) <= 1e-6
      && Math.abs(commandWaypoint.y - originalCommandWaypoint.y) <= 1e-6;

    pressKey("Z", ["control"]);
    await delay(150);
    const undoneWaypoint = await saveWaypoint();
    const commandUndoRestores = Math.hypot(undoneWaypoint.x - originalCommandWaypoint.x, undoneWaypoint.y - originalCommandWaypoint.y) <= 1e-6;
    const redoCancelOrigin = await center();
    const redoCancelTarget = { x: redoCancelOrigin.x + 38, y: redoCancelOrigin.y + 20 };
    await pressMouse(redoCancelOrigin);
    const redoCancelTargetLocal = await localAt(redoCancelTarget);
    moveMouse(redoCancelTarget);
    await waitForCorrect(redoCancelTarget, redoCancelTargetLocal);
    pressKey("Z", ["control"]);
    releaseMouse(redoCancelTarget);
    pressKey("Y", ["control"]);
    await delay(150);
    const redoneWaypoint = await saveWaypoint();
    const cancelPreservesRedo = Math.abs(redoneWaypoint.x - expectedNudgeX) <= 1e-6
      && Math.abs(redoneWaypoint.y - originalCommandWaypoint.y) <= 1e-6;

    await loadFixture();
    const switchOrigin = await center();
    const switchTarget = { x: switchOrigin.x + 35, y: switchOrigin.y + 15 };
    await pressMouse(switchOrigin);
    const switchTargetLocal = await localAt(switchTarget);
    moveMouse(switchTarget);
    await waitForCorrect(switchTarget, switchTargetLocal);
    await window.webContents.executeJavaScript("document.querySelector('button.pathsw-btn')?.click()");
    const switched = await waitFor(async () => window.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('button.pathlib-pick')]
        .find((candidate) => candidate.textContent.includes('Alternate benchmark path'));
      if (!button) return false;
      button.click();
      return true;
    })()`), 2000, "the alternate path picker");
    if (switched) await waitFor(
      () => window.webContents.executeJavaScript('document.querySelectorAll(\'[data-role="wp"]\').length === 3'),
      3000,
      "the alternate path",
    );
    releaseMouse({ x: switchOrigin.x + 70, y: switchOrigin.y + 30 });
    await delay(150);
    const pathSwitchShowsDestination = switched && await window.webContents.executeJavaScript('document.querySelectorAll(\'[data-role="wp"]\').length === 3');
    const pathSwitchSaveCount = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState().savedProjects.length");
    await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkCommand('save-project')");
    const pathSwitchState = await waitFor(async () => {
      const state = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
      return state.savedProjects.length > pathSwitchSaveCount ? state : null;
    }, 3000, "the project after switching paths during a drag");
    const switchedPrimaryWaypoint = pathSwitchState.savedProjects.at(-1).paths[0].waypoints[50];
    const pathSwitchCancelsDrag = pathSwitchShowsDestination
      && Math.hypot(switchedPrimaryWaypoint.x - originalCommandWaypoint.x, switchedPrimaryWaypoint.y - originalCommandWaypoint.y) <= 1e-6;

    await loadFixture();
    const openDragOrigin = await center();
    const openDragTarget = { x: openDragOrigin.x + 46, y: openDragOrigin.y - 18 };
    await pressMouse(openDragOrigin);
    const openDragTargetLocal = await localAt(openDragTarget);
    moveMouse(openDragTarget);
    await waitForCorrect(openDragTarget, openDragTargetLocal);
    await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkCommand('open-project')");
    await waitFor(async () => {
      const state = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
      return state.projectOperations.some((entry) => entry === "open:finish:opened") ? state : null;
    }, 3000, "the project opened during a drag");
    releaseMouse(openDragTarget);
    await delay(1000);
    const openDuringDragState = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
    const openDuringDragKeepsFile = !openDuringDragState.projectWrites.some((write) =>
      write.kind === "autosave" && write.target === "opened" && write.projectName === originalProject.name);

    await delay(150);
    await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkConfigure({ saveDelayMs: 120 })");
    const overlapOperationStart = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState().projectOperations.length");
    await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkCommand('save-project')");
    await waitFor(
      () => window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState().projectOperations.some((entry) => entry.startsWith('save:start:'))"),
      2000,
      "the delayed project save",
    );
    await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkCommand('open-project')");
    const overlappingSaveOpenState = await waitFor(async () => {
      const state = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
      const finished = state.projectOperations.slice(overlapOperationStart)
        .filter((entry) => entry.startsWith("save:finish:") || entry.startsWith("open:finish:"));
      return finished.length >= 2 ? state : null;
    }, 4000, "the save and project-open sequence");
    const overlapWrites = overlappingSaveOpenState.projectWrites.length;
    await delay(150);
    const overlapOrigin = await center();
    const overlapTarget = { x: overlapOrigin.x + 28, y: overlapOrigin.y + 12 };
    await pressMouse(overlapOrigin);
    const overlapTargetLocal = await localAt(overlapTarget);
    moveMouse(overlapTarget);
    await waitForCorrect(overlapTarget, overlapTargetLocal);
    releaseMouse(overlapTarget);
    const postOpenAutosaveState = await waitFor(async () => {
      const state = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
      return state.projectWrites.slice(overlapWrites).some((write) => write.kind === "autosave") ? state : null;
    }, 3000, "an autosave after the overlapping project open");
    const postOpenAutosaves = postOpenAutosaveState.projectWrites.slice(overlapWrites).filter((write) => write.kind === "autosave");
    const saveOpenKeepsFile = postOpenAutosaveState.currentFile === "reopened"
      && postOpenAutosaveState.maxConcurrentProjectOperations === 1
      && postOpenAutosaves.some((write) => write.target === "reopened" && write.projectName === reopenedProjectName)
      && postOpenAutosaves.every((write) => write.target !== "opened");

    const saveSnapshot = async (description) => {
      const before = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState().savedProjects.length");
      await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkCommand('save-project')");
      const state = await waitFor(async () => {
        const next = await window.webContents.executeJavaScript("window.bordeauxAPI.__benchmarkState()");
        return next.savedProjects.length > before ? next : null;
      }, 3000, description);
      return state.savedProjects.at(-1);
    };
    const beginMetadataDrag = async () => {
      const metadataOrigin = await center();
      const metadataTarget = { x: metadataOrigin.x + 40, y: metadataOrigin.y - 16 };
      await pressMouse(metadataOrigin);
      const metadataTargetLocal = await localAt(metadataTarget);
      moveMouse(metadataTarget);
      await waitForCorrect(metadataTarget, metadataTargetLocal);
      return metadataTarget;
    };
    const openPathActions = (pathName) => window.webContents.executeJavaScript(`(async () => {
      if (!document.querySelector('.pathlib-panel')) {
        document.querySelector('button.pathsw-btn')?.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      const row = [...document.querySelectorAll('.pathlib-item')].find((candidate) =>
        candidate.querySelector('.pathlib-name')?.textContent === ${JSON.stringify(pathName)});
      row?.querySelector('button.pathlib-more')?.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return Boolean(row);
    })()`);
    const closePathLibrary = () => window.webContents.executeJavaScript("document.querySelector('.pathlib-head button[aria-label=\"Close path library\"]')?.click()");

    const renameRelease = await beginMetadataDrag();
    await openPathActions(primaryPath.name);
    await window.webContents.executeJavaScript(`(async () => {
      const menu = document.getElementById('path-actions-${primaryPath.id}');
      [...menu.querySelectorAll('button')].find((button) => button.textContent.includes('Rename'))?.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const input = document.getElementById('path-library-name');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Renamed during drag');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      input.form.requestSubmit();
    })()`);
    releaseMouse(renameRelease);
    const renamedProject = await saveSnapshot("the renamed path to be saved");
    const renameSurvivesDrag = renamedProject.paths[0].name === "Renamed during drag";
    await closePathLibrary();

    const moveRelease = await beginMetadataDrag();
    await openPathActions("Renamed during drag");
    await window.webContents.executeJavaScript(`(async () => {
      document.getElementById('move-path-${primaryPath.id}')?.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      document.querySelector('#move-path-${primaryPath.id}-listbox [data-value="browser_benchmark_folder"]')?.click();
    })()`);
    releaseMouse(moveRelease);
    const movedProject = await saveSnapshot("the moved path to be saved");
    const moveSurvivesDrag = movedProject.paths[0].folderId === "browser_benchmark_folder";
    await closePathLibrary();

    const linkRelease = await beginMetadataDrag();
    await openPathActions(alternatePath.name);
    await window.webContents.executeJavaScript(`(async () => {
      document.getElementById('link-path-${alternatePath.id}')?.click();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      document.querySelector('#link-path-${alternatePath.id}-listbox [data-value="${primaryPath.id}"]')?.click();
    })()`);
    releaseMouse(linkRelease);
    const linkedProject = await saveSnapshot("the linked paths to be saved");
    const link = linkedProject.pathLinks.find((candidate) => candidate.fromPathId === alternatePath.id && candidate.toPathId === primaryPath.id);
    const sourceEnd = linkedProject.paths[1].waypoints.at(-1);
    const targetStart = linkedProject.paths[0].waypoints[0];
    const expectedSourceEnd = originalProject.paths[1].waypoints.at(-1);
    const linkSurvivesDrag = Boolean(link)
      && Math.hypot(sourceEnd.x - targetStart.x, sourceEnd.y - targetStart.y) <= 1e-6
      && Math.hypot(sourceEnd.x - expectedSourceEnd.x, sourceEnd.y - expectedSourceEnd.y) <= 1e-6;

    return { applicationWorkerTransport, nativeImagePaintProof, restoreConflictStaysDirty, staleProposalBlockedDuringDrag, proposalUsableAfterCancel, releaseUsesTerminalCoordinates: matchesTarget(releaseFinal, release, releaseLocal), releaseStable, saveIncludesDraft, closeGuardDirty, undoCancelsDrag, cancelAutosaveRestored, commandSurvivesDrag, commandUndoRestores, cancelPreservesRedo, pathSwitchCancelsDrag, openDuringDragKeepsFile, saveOpenKeepsFile, renameSurvivesDrag, moveSurvivesDrag, linkSurvivesDrag };
  }

  async function measureLatency() {
    await loadFixture();
    const origin = await center();
    await pressMouse(origin);
    const preflightWorkerTransport = await proveApplicationWorkerTransport(origin);
    await waitForPaintQuiet(80);
    await window.webContents.executeJavaScript("window.__rendererBenchmark.startTimedTransport('latency')");
    const correctPaintSamples = [];
    const anyPaintSamples = [];
    let target = origin;
    for (let index = 0; index < latencySamples; index++) {
      await waitForPaintQuiet(34);
      const direction = index % 2 === 0 ? 1 : -1;
      target = { x: origin.x + direction * (42 + index % 5), y: origin.y + ((index % 7) - 3) * 4 };
      const paintsBeforeArm = paintTimestamps.length;
      const token = await window.webContents.executeJavaScript("window.__rendererBenchmark.armPaintToken()");
      if (token.clearedPrevious) {
        await waitFor(() => paintTimestamps.length > paintsBeforeArm, 4000, "the paint-token clear to reach the compositor");
        await waitForPaintQuiet(34);
      }
      const sentAt = epochNow();
      const paintedGeometry = paintedGeometryAfter(sentAt, { target, token });
      moveMouse(target);
      const anyPaint = await paintAfter(sentAt);
      await waitFor(async () => {
        const value = await window.webContents.executeJavaScript("window.__rendererBenchmark.lastCorrect()");
        return value && value.paintToken?.id === token.id && Math.hypot(value.x - target.x, value.y - target.y) <= 1 ? value : null;
      }, 5000, "a correct-geometry frame");
      const correctPaint = await paintedGeometry;
      anyPaintSamples.push(anyPaint - sentAt);
      correctPaintSamples.push(correctPaint - sentAt);
    }
    const timedTransport = await window.webContents.executeJavaScript("window.__rendererBenchmark.finishTimedTransport('latency')");
    const applicationWorkerTransport = requireWorkerTransport
      ? preflightWorkerTransport
        && timedTransport.matchingWorkerResults >= latencySamples
        && timedTransport.interactiveWorkerRequests === timedTransport.matchingWorkerResults
        && timedTransport.directResults === 0
      : null;
    await window.webContents.executeJavaScript("window.__rendererBenchmark.clearPaintToken()");
    releaseMouse(target);
    await waitForPaintQuiet(100);
    return {
      anyPaintMs: statistics(anyPaintSamples),
      correctPaintMs: statistics(correctPaintSamples),
      samples: correctPaintSamples,
      applicationWorkerTransport,
      transport: { preflightWorkerTransport, ...timedTransport },
    };
  }

  async function measureStress() {
    await loadFixture();
    const origin = await center();
    await pressMouse(origin);
    const preflightWorkerTransport = await proveApplicationWorkerTransport(origin);
    await waitForPaintQuiet(80);
    await window.webContents.executeJavaScript("window.__rendererBenchmark.startTimedTransport('stress')");
    await window.webContents.executeJavaScript("window.__rendererBenchmark.start()");
    const firstPaint = paintTimestamps.length;
    const dispatchStartedAt = stressMainNow();
    const inputIntervalMs = 1000 / inputHz;
    const inputCount = Math.max(1, Math.floor(stressDurationMs / inputIntervalMs));
    let target = origin;
    const finalAngle = (inputCount - 1) / 11;
    const finalTarget = { x: origin.x + Math.cos(finalAngle) * 54, y: origin.y + Math.sin(finalAngle) * 32 };
    const finalTargetLocal = await localAt(finalTarget);
    for (let index = 0; index < inputCount; index++) {
      const remaining = dispatchStartedAt + index * inputIntervalMs - stressMainNow();
      if (remaining > 0.5) await delay(remaining);
      const angle = index / 11;
      target = { x: origin.x + Math.cos(angle) * 54, y: origin.y + Math.sin(angle) * 32 };
      moveMouse(target);
    }
    const paintEndAtInputDispatch = paintTimestamps.length;
    await waitForCorrect(target, finalTargetLocal);
    await waitFor(async () => {
      const value = await window.webContents.executeJavaScript("window.__rendererBenchmark.lastCorrect()");
      return value && Math.hypot(value.x - target.x, value.y - target.y) <= 1 ? value : null;
    }, 5000, "the final stress input's correct geometry record");
    releaseMouse(target);
    const probe = await window.webContents.executeJavaScript("window.__rendererBenchmark.stop()");
    const timedTransport = await window.webContents.executeJavaScript("window.__rendererBenchmark.finishTimedTransport('stress')");
    const applicationWorkerTransport = requireWorkerTransport
      ? preflightWorkerTransport
        && timedTransport.matchingWorkerResults >= 1
        && timedTransport.interactiveWorkerRequests === timedTransport.matchingWorkerResults
        && timedTransport.directResults === 0
      : null;
    const { startedAt, endedAt } = probe.inputBoundsRendererMs;
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt <= startedAt) {
      throw new Error("The renderer did not observe a bounded stress input window.");
    }
    const framesDuringInput = probe.frames.filter((timestamp) => timestamp >= startedAt && timestamp <= endedAt);
    // Bound the sample so a stall that resumes after input ends is still charged to the input window.
    const frameBoundaries = [startedAt, ...framesDuringInput, endedAt];
    const frameDeltas = frameBoundaries.slice(1)
      .map((timestamp, index) => timestamp - frameBoundaries[index])
      .filter((duration) => duration > 0);
    if (!frameDeltas.length) throw new Error("The stress input window produced no measurable frame intervals.");
    const geometry = probe.geometry.filter((timestamp) => timestamp >= startedAt && timestamp <= endedAt);
    const geometryBoundaries = [startedAt, ...geometry, endedAt];
    const geometryGaps = geometryBoundaries.slice(1).map((timestamp, index) => timestamp - geometryBoundaries[index]);
    const paints = paintTimestamps.slice(firstPaint, paintEndAtInputDispatch);
    const actualDurationMs = endedAt - startedAt;
    await waitForPaintQuiet(100);
    return {
      actualDurationMs,
      inputEvents: inputCount,
      frameDeltas,
      paintCallbackRateHz: paints.length / actualDurationMs * 1000,
      correctCurveUpdates: geometry.length,
      correctCurveRateHz: geometry.length / actualDurationMs * 1000,
      maxCorrectCurveGapMs: Math.max(...geometryGaps),
      applicationWorkerTransport,
      transport: { preflightWorkerTransport, ...timedTransport },
      timingBoundsRendererMs: { startedAt, endedAt },
      rawGeometryRendererMs: probe.geometry,
      ...frameSummary(frameDeltas),
    };
  }

  try {
    const correctness = checkCorrectness ? await correctnessChecks() : null;
    if (correctnessOnly) {
      process.stdout.write(`BORDEAUX_BROWSER_BENCHMARK=${JSON.stringify({
        label,
        runtime: { chrome: process.versions.chrome, electron: process.versions.electron, node: process.versions.node },
        fixture: { waypoints: 100, viewport: "1440x900" },
        correctness,
      })}\n`);
      return;
    }
    const latency = await measureLatency();
    const stress = await measureStress();
    const result = {
      label,
      runtime: { chrome: process.versions.chrome, electron: process.versions.electron, node: process.versions.node },
      fixture: { waypoints: 100, viewport: "1440x900", inputHz, compositorFrameRateHz: 60 },
      correctness,
      latency,
      stress,
    };
    process.stdout.write(`BORDEAUX_BROWSER_BENCHMARK=${JSON.stringify(result)}\n`);
  } finally {
    window.destroy();
    app.quit();
  }
}).catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  app.quit();
  process.exitCode = 1;
});
