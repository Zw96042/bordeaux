// Bordeaux — docked right inspector. ALWAYS visible; content swaps with the
// selection (none / waypoint / segment / range / marker). Smart defaults: paths are
// smooth & tangent-following unless you intervene. Needs React + window.UI.
// Exports window.ContextInspector
(function () {
  const h = React.createElement;
  const { Num, Toggle, Seg, Icon, constraintRangeSummary } = window.UI;
  const { FIELD_W, FIELD_H } = window.FIELD_DIMS;
  const R2D = 180 / Math.PI;

  const ANCHOR_HINT = {
    param: 'Holds a fixed percent of the path as its length changes.',
    dist: 'Pinned to physical travel distance from the path start.',
    wp: 'Tied to a waypoint span, so it follows those waypoints.',
  };
  const HEAD_MODES = [{ v: 'manual', label: 'Manual' }, { v: 'tangent', label: 'Tangent' }, { v: 'targets', label: 'Targets' }];
  const HEAD_HINT = {
    manual: 'Heading comes only from waypoints you pin. Rotation targets are ignored.',
    tangent: 'Robot points along the path tangent everywhere. Rotation targets are ignored.',
    targets: 'Heading interpolates between pinned waypoints and rotation targets.',
    lookAt: 'Robot continuously faces one draggable point on the field.',
  };

  const handleLen = (w, key) => Math.hypot(w[key].x - w.x, w[key].y - w.y);
  const segNorm = (t) => (t === 'line' || t === 'arc' || t === 'clothoid') ? t : 'bezier';
  const wpName = (i, n) => i === 0 ? 'Start' : i === n - 1 ? 'End' : 'Waypoint ' + i;

  function ConstraintsBody({ c, robot, setC, labview, setLabview, plannerId, moreLimits, setMoreLimits, moreBdx, setMoreBdx }) {
    const labviewPlanner = plannerId === 'labviewBezier' || plannerId === 'labviewClothoid';
    const rotation = moreLimits ? h('div', { className: 'grid2 compact-fields' },
      h(Num, { label: 'Max \u03c9', value: c.maxAngVel, unit: '\u00b0/s', step: 1, precision: 0, onChange: (v) => setC({ maxAngVel: v }) }),
      h(Num, { label: 'Max \u03b1', value: c.maxAngAccel, unit: '\u00b0/s\u00b2', step: 1, precision: 0, onChange: (v) => setC({ maxAngAccel: v }) })) : null;
    const flags = moreBdx ? h(React.Fragment, null,
      h(Num, { label: 'Current limit', value: labview.currentLimit || 0, unit: 'A', min: 0, onChange: (v) => setLabview({ currentLimit: v }) }),
      [['Reverse path', 'reversePath'], ['Zero velocity', 'zeroVelocity'], ['Zero translation', 'zeroTranslationalVelocity'], ['Correct at start', 'correctAtBeginningOfPath'], ['Pickup balls', 'pickupBalls']].map(([label, key]) =>
        h('div', { className: 'inrow', key }, h('span', { className: 'inrow-l' }, label), h(Toggle, { on: !!labview[key], ariaLabel: label, onChange: (v) => setLabview({ [key]: v }) })))) : null;
    const compatibility = labviewPlanner ? h(React.Fragment, null,
      h('div', { className: 'cgroup-h' }, 'LabVIEW'),
      h('div', { className: 'grid2' },
        h(Num, { label: 'Sample period', value: (labview.samplePeriodS || 0.02) * 1000, unit: 'ms', min: 1, max: 100, step: 1, precision: 0, onChange: (v) => setLabview({ samplePeriodS: v / 1000 }) }),
        plannerId === 'labviewClothoid'
          ? h(Num, { label: 'Min radius', value: labview.minTurnRadiusM || 0.5, unit: 'm', min: 0.05, step: 0.05, precision: 2, onChange: (v) => setLabview({ minTurnRadiusM: v }) })
          : h('div', null)),
      plannerId === 'labviewBezier' ? h(React.Fragment, null,
        h('div', { className: 'fieldlabel' }, 'Tangents'),
  }

  function FaceRow({ i, actions, n }) {
    if (n < 2) return null;
    return h('div', { className: 'facerow' },
      h('button', { className: 'facebtn', type: 'button', title: 'Face next waypoint', disabled: i >= n - 1, onClick: () => actions.faceWaypoint(i, 'next') }, 'Face next'),
      h('button', { className: 'facebtn', type: 'button', title: 'Face previous waypoint', disabled: i <= 0, onClick: () => actions.faceWaypoint(i, 'prev') }, 'Face prev'),
      h('button', { className: 'facebtn', type: 'button', title: 'Align to path tangent', onClick: () => actions.faceWaypoint(i, 'tangent') }, 'Tangent'));
  }

  function ContextInspector(props) {
    const { doc, sel, derived, actions, drive, robot, onClose } = props;
    const [moreLimits, setMoreLimits] = React.useState(false);
    const wps = doc.waypoints;
    const isTank = drive === 'tank';
    const n = wps.length;
    const headingMode = isTank ? 'tangent' : (doc.headingMode || 'targets');

    let icon = 'route', title = '', tag = null, body = null, closable = true;

    // ---------------- NO SELECTION → path summary, heading mode, global constraints ----------------
    if (!sel.kind) {
      closable = false;
      icon = 'route'; title = doc.name || 'Path'; tag = 'summary';
      const warns = derived.warnings || [];
      const high = warns.filter((w) => w.sev === 'high').length;
      body = h(React.Fragment, null,
        h('div', { className: 'fieldlabel first' }, 'Path summary'),
        h('div', { className: 'psum' },
          h('div', { className: 'psum-row' }, h('span', null, 'Duration'), h('b', null, (derived.prof.totalTime || 0).toFixed(2) + ' s')),
          h('div', { className: 'psum-row' }, h('span', null, 'Length'), h('b', null, (derived.sample.length || 0).toFixed(2) + ' m')),
          h('div', { className: 'psum-row' }, h('span', null, 'Diagnostics'), h('b', { className: warns.length ? (high ? 'bad' : 'warn') : 'good' }, warns.length ? (warns.length + (high ? ' \u00b7 ' + high + ' critical' : (warns.length > 1 ? ' checks' : ' check'))) : 'No issues'))),
        h('div', { className: 'qrow', style: { marginTop: '10px' } },
          h('button', { className: 'qbtn', type: 'button', onClick: () => actions.reversePath() }, h(Icon, { name: 'shuffle', size: 14 }), 'Reverse path'),
          h('button', { className: 'qbtn', type: 'button', onClick: () => actions.addWaypointEnd() }, h(Icon, { name: 'plus', size: 14 }), 'Add waypoint')),

        h('div', { className: 'cgroup-h' }, 'Heading'),
        isTank
          ? h('div', { className: 'hint' }, h(Icon, { name: 'info', size: 14 }), 'Tank drive \u2014 heading always follows the path tangent.')
          : h(React.Fragment, null,
              h(Seg, { value: headingMode, options: HEAD_MODES, onChange: (v) => actions.setHeadingMode(v) }),
              h('div', { className: 'seg-hint' }, HEAD_HINT[headingMode]),
              h('div', { className: 'inrow' },
                h('span', { className: 'inrow-l' }, 'Drive backward', h('small', null, 'reverse robot, same geometry')),
                h(Toggle, { on: !!doc.driveBackward, onChange: () => actions.toggleDriveBackward() }))),

        h('div', { className: 'cgroup-h' }, 'Endpoints'),
        h('div', { className: 'grid2' },
          h(Num, { label: 'Start vel', value: doc.startVel || 0, unit: 'm/s', min: 0, onChange: (v) => actions.setDoc({ startVel: v }) }),
          h(Num, { label: 'Goal vel', value: doc.goalVel || 0, unit: 'm/s', min: 0, onChange: (v) => actions.setDoc({ goalVel: v }) })),
        h('div', { style: { height: '2px' } }),
        h('div', { className: 'cgroup-h' }, 'Global constraints'),
        h(ConstraintsBody, { c: doc.constraints, robot, setC: actions.setConstraint }));
    }

    // ---------------- WAYPOINT ----------------
    else if (sel.kind === 'wp' && wps[sel.idx]) {
      const i = sel.idx, w = wps[i];
      const isStart = i === 0, isEnd = i === n - 1, isAnchor = isStart || isEnd;
      icon = 'waypoint'; title = wpName(i, n); tag = isAnchor ? 'anchor' : null;
      body = h(React.Fragment, null,
        h('div', { className: 'grid2' },
          h(Num, { label: 'X', value: w.x, unit: 'm', onChange: (v) => actions.setWp(i, { x: v }) }),
          h(Num, { label: 'Y', value: w.y, unit: 'm', onChange: (v) => actions.setWp(i, { y: v }) })),

        // Heading — mode-aware
        h('div', { className: 'fieldlabel' }, 'Heading \u03b8'),
        isTank
          ? h('div', { className: 'hint' }, h(Icon, { name: 'info', size: 14 }), 'Tank \u2014 heading follows the path tangent.')
          : headingMode === 'tangent'
            ? h(React.Fragment, null,
                h('div', { className: 'hint' }, h(Icon, { name: 'compass', size: 14 }), 'Follows the path tangent. Drag the arrow on the field, or override here.'),
                h('button', { className: 'qbtn wide', type: 'button', style: { marginTop: '4px' }, onClick: () => { actions.setHeadingMode('manual'); actions.faceWaypoint(i, 'tangent'); } }, h(Icon, { name: 'compass', size: 14 }), 'Override \u2014 set manual heading'))
            : isAnchor
              ? h(React.Fragment, null,
                  h(Num, { label: null, value: w.theta || 0, unit: '\u00b0', step: 1, precision: 1, onChange: (v) => actions.setWp(i, { theta: v }) }),
                  h(FaceRow, { i, actions, n }))
              : h(React.Fragment, null,
                  h('div', { className: 'inrow first' },
                    h('span', { className: 'inrow-l' }, 'Pin heading here', h('small', null, 'otherwise it interpolates')),
                    h(Toggle, { on: !!w.thetaOn, onChange: (v) => actions.toggleTheta(i, v) })),
                  w.thetaOn && h(Num, { label: null, value: w.theta || 0, unit: '\u00b0', step: 1, precision: 1, onChange: (v) => actions.setWp(i, { theta: v }) }),
                  h(FaceRow, { i, actions, n })),

        // Stop & wait
        !isAnchor && h('div', { className: 'inrow' },
          h('span', { className: 'inrow-l' }, 'Stop here', h('small', null, 'decelerate to a full stop')),
          h(Toggle, { on: !!w.stop, onChange: (v) => actions.setStop(i, v) })),
        !isAnchor && w.stop && h('div', { className: 'fieldlabel' }, 'Wait at waypoint'),
        !isAnchor && w.stop && h(Num, { label: null, value: w.wait || 0, unit: 's', step: 0.1, precision: 1, min: 0, onChange: (v) => actions.setWait(i, v) }),
        isAnchor && h('div', { className: 'fieldlabel' }, isStart ? 'Start velocity' : 'End velocity'),
        isAnchor && h(Num, { label: null, value: isStart ? (doc.startVel || 0) : (doc.goalVel || 0), unit: 'm/s', min: 0, onChange: (v) => actions.setDoc(isStart ? { startVel: v } : { goalVel: v }) }),

        // Tangent handles — always editable, auto-continuous unless corner/stop
        h('div', { className: 'fieldlabel' }, 'Tangent handles'),
        h('div', { className: 'grid2' },
          !isStart && h(Num, { label: 'In', value: handleLen(w, 'prevC'), unit: 'm', min: 0.1, onChange: (v) => actions.setHandleLen(i, 'prevC', v) }),
          !isEnd && h(Num, { label: 'Out', value: handleLen(w, 'nextC'), unit: 'm', min: 0.1, onChange: (v) => actions.setHandleLen(i, 'nextC', v) })),
        !isAnchor && h('div', { className: 'inrow' },
          h('span', { className: 'inrow-l' }, 'Corner', h('small', null, 'break tangent continuity')),
          h(Toggle, { on: !!w.corner, onChange: (v) => actions.toggleCorner(i, v) })),
        h('div', { className: 'seg-hint' }, w.stop ? 'Stopped \u2014 leave in any direction.' : w.corner ? 'Corner \u2014 in/out handles move independently.' : 'Handles stay mirrored (180\u00b0) automatically; drag either to reshape.'),

        !isAnchor && h('div', { className: 'qrow', style: { marginTop: '14px' } },
          h('button', { className: 'qbtn', type: 'button', onClick: () => actions.duplicateWp(i) }, h(Icon, { name: 'copy', size: 14 }), 'Duplicate'),
          h('button', { className: 'qbtn danger', type: 'button', onClick: () => actions.delWp(i) }, h(Icon, { name: 'trash', size: 14 }), 'Delete')));
    }

    // ---------------- SEGMENT (true segment properties only) ----------------
    else if (sel.kind === 'seg' && wps[sel.idx] && wps[sel.idx + 1]) {
      const i = sel.idx;
      const st = segNorm(wps[i].segType);
      const segHint = (window.PM.SEGTYPES.find((s) => s.id === st) || {}).hint || '';
      icon = 'route'; title = 'Segment'; tag = (i === 0 ? 'Start' : 'WP' + i) + ' \u2192 ' + (i + 1 === n - 1 ? 'End' : 'WP' + (i + 1));
      let segLen = 0, minR = Infinity, dur = 0;
      if (derived.wpFrac && derived.sample.pts.length > 1) {
        const total = derived.sample.length || 1;
        const lo = derived.wpFrac[i], hi = derived.wpFrac[i + 1];
        segLen = (hi - lo) * total;
        const pts = derived.sample.pts;
        for (let k = 0; k < pts.length; k++) { const f = pts[k].s / total; if (f >= lo && f <= hi && pts[k].curv > 1e-4) minR = Math.min(minR, 1 / pts[k].curv); }
        if (derived.prof.t && derived.wpIdx) dur = (derived.prof.t[derived.wpIdx[i + 1]] || 0) - (derived.prof.t[derived.wpIdx[i]] || 0);
      }
      const segLo = derived.wpFrac ? derived.wpFrac[i] : 0, segHi = derived.wpFrac ? derived.wpFrac[i + 1] : 1;
      const affecting = (doc.ranges || []).map((rg, ri) => ({ rg, ri, ef: (derived.effRanges && derived.effRanges[ri]) || rg }))
        .filter((x) => { const lo = Math.min(x.ef.f0, x.ef.f1), hi = Math.max(x.ef.f0, x.ef.f1); return hi >= segLo && lo <= segHi; });
      body = h(React.Fragment, null,
        h('div', { className: 'fieldlabel first' }, wpName(i, n) + ' \u2192 ' + wpName(i + 1, n)),
        Stat3([
          { v: segLen.toFixed(2) + 'm', k: 'Length' },
          { v: isFinite(minR) ? minR.toFixed(2) + 'm' : '\u221e', k: 'Min radius', color: isFinite(minR) && minR < 0.7 ? 'var(--bad)' : null },
          { v: dur.toFixed(2) + 's', k: 'Duration' },
        ]),
        h('div', { className: 'fieldlabel' }, 'Path type'),
        h(GroupSelect, { value: st, items: window.PM.SEGTYPES, onChange: (v) => actions.setSegMeta(i, { segType: v }) }),
        h('div', { className: 'seg-hint' }, segHint),
        h('div', { className: 'fieldlabel' }, 'Constraint ranges here'),
        affecting.length === 0
          ? h('div', { className: 'seg-hint', style: { marginTop: '0' } }, 'None \u2014 drag the range tool along this stretch to add one.')
          : h('div', { className: 'segranges' }, affecting.map((x) => h('button', { key: x.ri, className: 'segrange', type: 'button', onClick: () => actions.select('cr', x.ri) },
              h('span', { className: 'segrange-dot' }), '\u2264' + x.rg.maxVel.toFixed(1) + ' m/s', x.rg.name ? h('span', { className: 'segrange-nm' }, x.rg.name) : null))),
        h('button', { className: 'qbtn wide', type: 'button', style: { marginTop: '14px' }, onClick: () => actions.insertWp(i) }, h(Icon, { name: 'plus', size: 14 }), 'Insert waypoint in segment'),
        h('div', { className: 'chint' }, 'Continuity belongs to the waypoints at each end \u2014 set Corner/Stop there. This card edits the segment\u2019s own geometry.'));
    }

    // ---------------- ROTATION TARGET ----------------
    else if (sel.kind === 'rt' && doc.targets[sel.idx]) {
      const t = doc.targets[sel.idx];
      icon = 'rotation'; title = 'Rotation Target'; tag = 'heading';
      body = h(React.Fragment, null,
        headingMode !== 'targets' && h('div', { className: 'hint' }, h(Icon, { name: 'info', size: 14 }), 'Inactive \u2014 heading mode is \u201c' + headingMode + '\u201d. Switch to Targets to use rotation targets.'),
        h('div', { className: 'fieldlabel first' }, 'Target heading'),
        h(Num, { label: null, value: t.deg, unit: '\u00b0', step: 1, precision: 1, onChange: (v) => actions.setTarget(sel.idx, { deg: v }) }),
        h('div', { className: 'fieldlabel' }, 'Position along path'),
        h(Num, { label: null, value: t.f * 100, unit: '%', step: 1, precision: 0, min: 0, max: 100, onChange: (v) => actions.setTarget(sel.idx, { f: v / 100 }) }),
        h('button', { className: 'delbtn', type: 'button', onClick: () => actions.delTarget(sel.idx) }, h(Icon, { name: 'trash', size: 15 }), 'Delete target'));
    }

    // ---------------- EVENT MARKER ----------------
    else if (sel.kind === 'em' && doc.markers[sel.idx]) {
      const m = doc.markers[sel.idx];
      icon = 'flag2'; title = 'Event Marker';
      body = h(React.Fragment, null,
        h('div', { className: 'fieldlabel first' }, 'Name'),
        h('input', { className: 'textinput', value: m.name, onChange: (e) => actions.setMarker(sel.idx, { name: e.target.value }) }),
        h('div', { className: 'fieldlabel' }, 'Command'),
        h('select', { className: 'selectinput', value: m.cmd, onChange: (e) => actions.setMarker(sel.idx, { cmd: e.target.value }) }, COMMANDS.map((c) => h('option', { key: c, value: c }, c))),
        h('div', { className: 'fieldlabel' }, 'Group type'),
        h(Seg, { value: m.group || 'sequential', options: [{ v: 'sequential', label: 'Seq' }, { v: 'parallel', label: 'Parallel' }, { v: 'deadline', label: 'Deadline' }], onChange: (v) => actions.setMarker(sel.idx, { group: v }) }),
        h('div', { className: 'fieldlabel' }, 'Position along path'),
        h(Num, { label: null, value: m.f * 100, unit: '%', step: 1, precision: 0, min: 0, max: 100, onChange: (v) => actions.setMarker(sel.idx, { f: v / 100 }) }),
        h('button', { className: 'delbtn', type: 'button', onClick: () => actions.delMarker(sel.idx) }, h(Icon, { name: 'trash', size: 15 }), 'Delete marker'));
    }

    // ---------------- CONSTRAINT RANGE ----------------
    else if (sel.kind === 'cr' && doc.ranges && doc.ranges[sel.idx]) {
      const rg = doc.ranges[sel.idx];
      const len = derived.sample.length || 1;
      const effR = (derived.effRanges && derived.effRanges[sel.idx]) || { f0: rg.f0 || 0, f1: rg.f1 || 0 };
      const loF = Math.min(effR.f0, effR.f1), hiF = Math.max(effR.f0, effR.f1);
      icon = 'gauge'; title = 'Constraint Range';
      tag = (loF * len).toFixed(1) + '\u2013' + (hiF * len).toFixed(1) + ' m';
      body = h(React.Fragment, null,
        h('div', { className: 'fieldlabel first' }, 'Max velocity'),
        h(Num, { label: null, value: rg.maxVel, unit: 'm/s', min: 0, onChange: (v) => actions.setRange(sel.idx, { maxVel: v }) }),
        h('button', { className: 'morebtn' + (moreLimits ? ' on' : ''), type: 'button', onClick: () => setMoreLimits(!moreLimits) }, h(Icon, { name: 'chevron', size: 14 }), moreLimits ? 'Fewer limits' : 'More limits \u00b7 accel & rotation'),
        moreLimits && h(React.Fragment, null,
          h('div', { className: 'cgroup-h' }, 'Translation'),
          h('div', { className: 'grid2' },
            h(Num, { label: 'Max accel', value: rg.maxAccel, unit: 'm/s\u00b2', min: 0, onChange: (v) => actions.setRange(sel.idx, { maxAccel: v }) }),
            h(Num, { label: 'Max decel', value: rg.maxDecel, unit: 'm/s\u00b2', min: 0, onChange: (v) => actions.setRange(sel.idx, { maxDecel: v }) })),
          h('div', { className: 'cgroup-h' }, 'Rotation'),
          h('div', { className: 'grid2' },
            h(Num, { label: 'Max \u03c9', value: rg.maxAngVel, unit: '\u00b0/s', step: 1, precision: 0, onChange: (v) => actions.setRange(sel.idx, { maxAngVel: v }) }),
            h(Num, { label: 'Max \u03b1', value: rg.maxAngAccel, unit: '\u00b0/s\u00b2', step: 1, precision: 0, onChange: (v) => actions.setRange(sel.idx, { maxAngAccel: v }) }))),
        h('div', { className: 'fieldlabel' }, 'Label'),
        h('input', { className: 'textinput', value: rg.name || '', placeholder: 'e.g. Reef approach', onChange: (e) => actions.setRange(sel.idx, { name: e.target.value }) }),
        h('div', { className: 'chint' }, 'Drawn directly on the trajectory \u2014 drag its endpoints on the field to move or resize it. Where ranges overlap, the tightest limit wins.'),
        h('button', { className: 'delbtn', type: 'button', onClick: () => actions.delRange(sel.idx) }, h(Icon, { name: 'trash', size: 15 }), 'Delete range'));
    } else {
      return null;
    }

    return h('div', { className: 'ctxinsp' },
      h('div', { className: 'ctxinsp-hd' },
        h('span', { className: 'ctxinsp-ic' }, h(Icon, { name: icon, size: 15 })),
        h('span', { className: 'ctxinsp-t' }, title),
        tag && h('span', { className: 'ctxinsp-tag' }, tag),
        closable && h('button', { className: 'ctxinsp-x', type: 'button', title: 'Clear selection', onClick: onClose }, h(Icon, { name: 'x', size: 14 }))),
      h('div', { className: 'ctxinsp-body' }, body));
  }

  window.ContextInspector = ContextInspector;
})();
