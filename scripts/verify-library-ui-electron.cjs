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
