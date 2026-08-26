    check('searchable shared position links propagate coordinates only, support project undo/redo, and unlink cleanly');
    await evaluate(() => {
      window.__routinePendingCheck = { samples: 0, violations: [] };
      window.__routinePendingObserver = new MutationObserver(() => {
        if (!document.querySelector('.routine-status.planning')) return;
        window.__routinePendingCheck.samples++;
        const skipped = [...document.querySelectorAll('.rt-step-meta')].filter((element) => element.textContent.includes('Skipped in this preview') && !element.closest('.rt-branch:not(.live)'));
        if (skipped.length) window.__routinePendingCheck.violations.push(skipped.map((element) => element.textContent));
      });
      window.__routinePendingObserver.observe(document.querySelector('#root'), { subtree: true, childList: true, characterData: true });
    });
    await click('.library-tabs button', 'Routines'); await click('[data-library-item="routine-a"]');
    await wait(() => evaluate(() => !document.querySelector('.routine-status.planning')), 'routine planning settles');
    const pending = await evaluate(() => { window.__routinePendingObserver.disconnect(); return window.__routinePendingCheck; });
    assert.ok(pending.samples > 0, 'Regression must observe an actual pending routine render');
    assert.deepEqual(pending.violations, [], 'Pending preview-included routine nodes must not flash skipped status');
    check('actual pending routine renders never label included paths as skipped before planning settles');
    // Restoring a project calculates the unopened path, without selecting it.
    saved = { ...saved, pathLinks: [], routines: [], activeRoutineId: '', paths: saved.paths.slice(0, 2).map((path, index) => ({
      ...path, optimization: undefined, headingMode: 'manual', driveBackward: false, startVel: 0, goalVel: 0,
      markers: [], targets: [], ranges: [], waypoints: [2, 4 + index * 2].map((x) => ({
        x, y: 3, theta: 0, thetaOn: true, linked: true, stop: false, segType: 'line',
        prevC: { x: x - .5, y: 3 }, nextC: { x: x + .5, y: 3 },
      })),
    })) };
    saved.editor = { activePathId: saved.paths[0].id };
    await win.loadFile(path.resolve('dist-renderer/index.html'));
    await wait(() => evaluate(() => {
      const labels = [...document.querySelectorAll('.library-meta')];
      return labels.length === 2 && labels.every((label) => /^\d+\.\d{2} s$/.test(label.textContent));
    }), 'restored unopened path durations');
    const durationLayout = await evaluate(() => [...document.querySelectorAll('.library-row')].map((row) => {
      const name = row.querySelector('.library-name'), time = row.querySelector('.library-meta');
      const center = (element) => { const rect = element.getBoundingClientRect(); return rect.y + rect.height / 2; };
      return { row: center(row), name: center(name), time: center(time), seconds: parseFloat(time.textContent) };
    }));
    for (const layout of durationLayout) {
      assert.ok(Math.abs(layout.time - layout.row - 1) < .1, 'Duration uses the optical centering offset within its row');
      assert.ok(Math.abs(layout.name - layout.time) < .1, 'Name and duration share the same vertical center');
    }
    assert.ok(durationLayout[1].seconds > durationLayout[0].seconds, 'Unopened longer path has its own calculated time');
    assert.equal(await evaluate(() => document.querySelector('.library-pick[aria-current="true"]').dataset.libraryItem), saved.paths[0].id);
    await fs.writeFile(path.join(output, 'restored-path-durations.png'), (await win.webContents.capturePage()).toPNG());
    check('unopened paths receive current trajectory times after restore, with vertically centered names and durations');
    await wait(() => evaluate(() => !document.querySelector('.fieldcol[inert]')), 'fault injection baseline ready');
    const beforeFailure = structuredClone(saved.paths[0]);
    await evaluate((pathId) => {
      const post = Worker.prototype.postMessage;
      window.__restoreWorkerPost = () => { Worker.prototype.postMessage = post; delete window.__restoreWorkerPost; };
      Worker.prototype.postMessage = function (message, ...args) {
        if (message.quality === 'interactive' && message.path.id === pathId && message.path.waypoints[0].x === 2.25) {
          setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: { id: message.id, error: { message: 'Injected interactive planning failure' } } })), 0);
          return;
        }
        return post.call(this, message, ...args);
      };
    }, saved.paths[0].id);
    await click('.wpfeatrow .featselect');
    await editNumber('X', 2.25);
    await click('.optimizer-toggle');
    await wait(() => evaluate(() => document.querySelector('.optimizer-failure')?.textContent.includes('Injected interactive planning failure')), 'current error shown over retained preview');
    assert.equal(await evaluate(() => Boolean(document.querySelector('.fieldcol[inert]'))), true, 'Stale geometry must stay inert');
    assert.equal(await evaluate(() => Boolean(document.querySelector('.optimizer-panel').closest('[inert]'))), false, 'Error recovery must remain usable');
    assert.equal(await evaluate(() => document.querySelector('.optimizer-main').textContent), 'Undo last edit');
    await fs.writeFile(path.join(output, 'optimizer-interactive-failure.png'), (await win.webContents.capturePage()).toPNG());
    await click('.optimizer-main');
    await wait(() => evaluate(() => !document.querySelector('.optimizer-failure') && !document.querySelector('.fieldcol[inert]')), 'Undo recovers planning');
    await evaluate(() => window.__restoreWorkerPost());
    await click('[aria-label="Save project"]');
    assert.deepEqual(saved.paths[0].waypoints, beforeFailure.waypoints);
    await click('.optimizer-toggle');
    check('interactive planning failure retains the preview, exposes the current error, and recovers through Undo');

    saved.paths[0] = { ...structuredClone(source), id: saved.paths[0].id, name: 'Collect the second game piece from the far loading station' };
    saved.paths[0].waypoints[1] = { ...saved.paths[0].waypoints[1], thetaOn: true, theta: -178, stop: true, wait: 12.5 };
    saved.routines = [{ id: 'long-flow', name: 'Long content check', nodes: [{ id: 'long-step', type: 'path', ref: saved.paths[0].id }] }];
    saved.activeRoutineId = 'long-flow';
    await win.loadFile(path.resolve('dist-renderer/index.html'));
    await wait(() => evaluate(() => !document.querySelector('.fieldcol[inert]') && document.querySelectorAll('.wpfeatrow').length === 3), 'badge-rich waypoint fixture');
    for (const [width, height] of [[1440, 900], [1100, 720]]) {
      win.setContentSize(width, height); await delay(100);
      const waypointLayout = await evaluate(() => { const row = document.querySelectorAll('.wpfeatrow')[1], name = row.querySelector('.featnm'), details = row.querySelector('.featdetails'); return { name: name.textContent, fits: name.scrollWidth <= name.clientWidth, separated: details.getBoundingClientRect().top >= name.getBoundingClientRect().bottom, detailsFit: details.scrollWidth <= details.clientWidth }; });
      assert.deepEqual(waypointLayout, { name: 'Waypoint 1', fits: true, separated: true, detailsFit: true });
      assert.equal(await evaluate(() => ['.library-name', '.library-current-name', '.ctxinsp-t'].every((selector) => { const el = document.querySelector(selector); return el.scrollWidth <= el.clientWidth && getComputedStyle(el).whiteSpace === 'normal'; })), true, 'Primary path names stay readable across library and inspector');
      await fs.writeFile(path.join(output, `waypoint-badges-${width}.png`), (await win.webContents.capturePage()).toPNG());
      await click('.library-tabs button', 'Routines');
      await click('.rt-step-body');
      const beforeHover = await evaluate(() => { const el = document.querySelector('.rt-step-body'); return el.getBoundingClientRect().width; });
      const point = await evaluate(() => { const r = document.querySelector('.rt-step-body').getBoundingClientRect(); return { x: Math.round(r.x+20), y: Math.round(r.y+20) }; });
      win.webContents.sendInputEvent({ type: 'mouseMove', ...point }); await delay(100);
      const routineLayout = await evaluate(() => { const el = document.querySelector('.rt-step-body'), name = el.querySelector('.rt-step-title'); return { width: el.getBoundingClientRect().width, fits: name.scrollWidth <= name.clientWidth, wraps: getComputedStyle(name).whiteSpace === 'normal' }; });
      assert.equal(routineLayout.width, beforeHover, 'Hover must reserve action space');
      assert.equal(routineLayout.fits, true); assert.equal(routineLayout.wraps, true);
      await fs.writeFile(path.join(output, `routine-long-name-${width}.png`), (await win.webContents.capturePage()).toPNG());
      await click('[aria-label="Close step inspector"]'); await click('.library-tabs button', 'Paths');
    }
    check('waypoint badges and long routine names remain readable without hover layout shifts at both supported sizes');
    if (process.env.BORDEAUX_DURATION_PROJECT) {
      saved = JSON.parse(await fs.readFile(process.env.BORDEAUX_DURATION_PROJECT, 'utf8'));
      saved.editor = { activePathId: saved.paths[0].id };
      saved.routines = [{ id: 'duration-regression', name: 'Duration regression', nodes: saved.paths.map((path, index) => ({ id: 'duration-step-' + index, type: 'path', ref: path.id })) }];
      saved.activeRoutineId = 'duration-regression';
      await win.loadFile(path.resolve('dist-renderer/index.html'));
      await wait(() => evaluate(() => document.querySelectorAll('.library-meta').length > 1 && [...document.querySelectorAll('.library-meta')].every((label) => /^\d+\.\d{2} s$/.test(label.textContent))), 'actual project durations with stale optimization');
      await evaluate(() => document.querySelectorAll('.outline .sechead-toggle').forEach((button) => { if (button.getAttribute('aria-expanded') === 'false') button.click(); }));
      assert.equal(await evaluate(() => document.querySelector('.field-status')?.textContent.includes('Using normal trajectory') || false), false, 'Normal fallback does not show a passive banner');
      const outlineLayout = await evaluate(() => ({
        titleTag: document.querySelector('.library-section-title').tagName,
        addButtons: document.querySelectorAll('.outline .sechead .mini').length,
        rowStarts: [...document.querySelectorAll('.outline .featselect')].map((row) => row.getBoundingClientRect().x),
        labelTransforms: [...document.querySelectorAll('.ctxinsp .numlbl,.ctxinsp .cgroup-h')].map((label) => getComputedStyle(label).textTransform),
      }));
      assert.equal(outlineLayout.titleTag, 'DIV', 'Outline title does not add another collapse control');
      assert.equal(outlineLayout.addButtons, 0, 'Features are placed using the field tools');
      assert.ok(outlineLayout.rowStarts.length > 4 && Math.max(...outlineLayout.rowStarts) - Math.min(...outlineLayout.rowStarts) < 1, 'Waypoint and feature content columns align');
      assert.ok(outlineLayout.labelTransforms.every((value) => value === 'none'), 'Inspector labels preserve sentence case');
      const segmentLayout = await evaluate(() => [...document.querySelectorAll('.segfeatrow')].map((row) => {
        const name = row.querySelector('.featnm'), meta = row.querySelector('.featmeta');
        return { wraps: getComputedStyle(name).whiteSpace === 'normal', fits: name.scrollWidth <= name.clientWidth + 1, stacked: meta.getBoundingClientRect().top >= name.getBoundingClientRect().bottom };
      }));
      assert.ok(segmentLayout.length > 0 && segmentLayout.every((row) => row.wraps && row.fits && row.stacked), 'Segment names wrap without truncation, with curve type below');
      check('outline groups share aligned item rows without nested collapse or arbitrary add controls');
      await fs.writeFile(path.join(output, 'actual-project-durations.png'), (await win.webContents.capturePage()).toPNG());
      await click('.library-tabs button', 'Routines');
      await wait(() => evaluate(() => !document.querySelector('.routine-status') && document.querySelectorAll('.rt-step.path').length > 1), 'actual routine uses current normal trajectories');
      assert.equal(await evaluate(() => [...document.querySelectorAll('.rt-step-meta')].some((label) => /unavailable|Preparing/.test(label.textContent))), false);
      await fs.writeFile(path.join(output, 'actual-project-routine.png'), (await win.webContents.capturePage()).toPNG());
      check('actual saved project shows both durations and routine preview despite an outdated optimization');
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors }, null, 2));
    app.exit(0);
  } catch (error) { console.error(error); console.error(errors); await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ checks, errors, failure: error.message }, null, 2)); if (win) await fs.writeFile(path.join(output, 'failure.png'), (await win.webContents.capturePage()).toPNG()); app.exit(1); }
});
