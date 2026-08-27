    await switchPath(fixture.paths[0].name);
    await stable(applied, 250, 'Selected comparison restored on path switch');
    check('Normal comparison stays on the current path when switching between applied paths');
    await openSettings();
    await evaluate(() => {
      const input = document.querySelector('.optimizer-corridor input');
      if (!input) throw new Error('Corridor input missing');
      input.focus();
      input.select();
    });
    await window.webContents.insertText('0.30');
    await evaluate(() => {
      const input = document.querySelector('.optimizer-corridor input');
      input.blur();
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    project = await save();
    assert.equal(project.paths[0].optimization.corridorM, 0.30, 'The corridor input must commit its edited value');
    await waitFor(async () => /Needs update/.test((await snapshot()).status || ''), 'explicit stale optimization status');
    project = await save();
    assert.ok(project.paths[0].optimization.accepted, 'Stale artifacts remain available for an explicit choice');
    check('changing the corridor invalidates the selection with an explicit stale state');
    await click('.library-tabs button', 'Routines');
    await waitFor(() => evaluate(() => { const play = document.querySelector('button[aria-label="Play routine"]'); return play && !play.disabled && !document.querySelector('.routine-status'); }), 'the stale selection to use current normal routine planning');
    assert.ok((await save()).paths[0].optimization.accepted, 'Routine fallback must retain the stale artifact');
    check('stale accepted selections use current normal routine playback while retaining the artifact');
    await click('.library-tabs button', 'Paths');
    await click('.optimizer-panel button', 'Use normal');
    project = await save();
    assert.equal(project.paths[0].optimization.accepted, undefined);
    await ready();
    check('Use normal removes the accepted artifact');
    await click('.library-tabs button', 'Routines');
    await waitFor(() => evaluate(() => {
      const play = document.querySelector('button[aria-label="Play routine"]');
      return play && !play.disabled && !document.querySelector('.routine-status');
    }), 'routine playback after choosing normal');
    check('choosing normal restores routine playback');
    await click('.library-tabs button', 'Paths');
    await switchPath(fixture.paths[1].name);
    await click('button', 'Settings');
    await evaluate(() => {
      const input = document.querySelector('input[aria-label="Motor free speed"]');
      if (!input) throw new Error('Motor free-speed input missing');
      input.focus();
      input.select();
    });
    await window.webContents.insertText('1000');
    await evaluate(() => {
      const input = document.querySelector('input[aria-label="Motor free speed"]');
      input.blur();
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await click('button', 'Editor');
    await waitFor(async () => /Needs update/.test((await snapshot()).status || ''), 'physical robot edits to invalidate the applied trajectory');
    const currentNormalLabel = await evaluate(() => document.querySelector('button[aria-label="Preview normal trajectory"] b')?.textContent);
    assert.notEqual(currentNormalLabel, `${Number(alternateNormal.time).toFixed(2)} s`, 'Robot edits must not relabel old normal timing as current');
    project = await save();
    assert.ok(project.robot.maxSpeed < fixture.robot.maxSpeed / 2, 'The robot speed limit must be substantially lower');
    assert.equal(project.robot.driveModel.motorFreeRpm, 1000);
    assert.ok(project.paths[1].optimization.accepted, 'Robot edits retain the stale artifact for an explicit choice');
    await click('.optimizer-panel button', 'Use normal');
    await ready();
    const slowerNormal = await snapshot();
    assert.ok(Number(slowerNormal.time) > Number(alternateNormal.time) * 1.5, 'Current normal timing must reflect the slower robot');
    assert.equal(slowerNormal.geometry, alternateNormal.geometry, 'Changing robot speed must preserve the authored geometry');
    project = await save();
    assert.equal(project.paths[1].optimization.accepted, undefined);
    check('physical robot edits invalidate applied timing and regenerate the current slower normal trajectory');
    assert.deepEqual(errors, [], 'Renderer console must remain free of unexpected errors');
    check('renderer console has no unexpected errors');
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks, errors, knownConsoleWarnings,
      normalTimeS: Number(normal.time), optimizedTimeS: Number(applied.time), savedAcceptedTimeS: accepted.result.totalTimeS }, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error);
    if (window && !window.isDestroyed()) {
      await fs.writeFile(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG());
      await fs.writeFile(path.join(output, 'failure-dom.txt'), await evaluate(() => document.body.innerText));
    }
    await fs.writeFile(path.join(output, 'last-saved-project.json'), JSON.stringify(saved, null, 2));
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: false, checks, errors, knownConsoleWarnings, failure: error.message }, null, 2));
    app.exit(1);
  }
});
