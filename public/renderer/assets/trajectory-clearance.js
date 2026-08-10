// Robot-footprint clearance for preview-only geometry optimization.
// The 2026 field constants mirror src/shared/field/rebuilt2026.ts; differential
// tests protect this static renderer boundary.
(function () {
  const EPSILON = 1e-9;
  const FIELD_W = 17.548;
  const FIELD_H = 8.052;
  const OFFICIAL_LENGTH = 16.541;
  const OFFICIAL_WIDTH = 8.069;
  const BLUE_BARRIER_X = 4.02844;
  const STRUCTURE_DEPTH = 1.1938;
  const HUB_WIDTH = 1.1938;
  const TRENCH_WIDTH = 1.278636;
  const BUMP_WIDTH = 1.8542;
  const BUMP_TABLE_Y = 2.59461;
  const TRENCH_CLEARANCE_M = 22.25 * 0.0254;

  const officialPoint = (point) => ({
    x: (OFFICIAL_LENGTH - point.x) * FIELD_W / OFFICIAL_LENGTH,
    y: point.y * FIELD_H / OFFICIAL_WIDTH,
  });

  function officialBounds(xMin, xMax, yMin, yMax) {
    const first = officialPoint({ x: xMin, y: yMin });
    const second = officialPoint({ x: xMax, y: yMax });
    return {
      min: { x: Math.min(first.x, second.x), y: Math.min(first.y, second.y) },
      max: { x: Math.max(first.x, second.x), y: Math.max(first.y, second.y) },
    };
  }

  const RED_BARRIER_X = OFFICIAL_LENGTH - BLUE_BARRIER_X;
  const HUB_Y_MIN = (OFFICIAL_WIDTH - HUB_WIDTH) / 2;
  const obstacles = [
    officialBounds(BLUE_BARRIER_X, BLUE_BARRIER_X + STRUCTURE_DEPTH, HUB_Y_MIN, HUB_Y_MIN + HUB_WIDTH),
    officialBounds(RED_BARRIER_X - STRUCTURE_DEPTH, RED_BARRIER_X, HUB_Y_MIN, HUB_Y_MIN + HUB_WIDTH),
  ];
  const portalSpans = [
    [0, TRENCH_WIDTH, 'trench'],
    [OFFICIAL_WIDTH - TRENCH_WIDTH, OFFICIAL_WIDTH, 'trench'],
    [BUMP_TABLE_Y - BUMP_WIDTH / 2, BUMP_TABLE_Y + BUMP_WIDTH / 2, 'bump'],
    [OFFICIAL_WIDTH - BUMP_TABLE_Y - BUMP_WIDTH / 2, OFFICIAL_WIDTH - BUMP_TABLE_Y + BUMP_WIDTH / 2, 'bump'],
  ].map(([minY, maxY, traversal]) => {
    const first = officialPoint({ x: 0, y: minY });
    const second = officialPoint({ x: 0, y: maxY });
    return { minY: Math.min(first.y, second.y), maxY: Math.max(first.y, second.y), traversal };
  });
  const barriers = [BLUE_BARRIER_X, RED_BARRIER_X].map((x) => ({ x: officialPoint({ x, y: 0 }).x, portals: portalSpans }));

  function localFootprint(robot) {
    return robot.footprint && robot.footprint.kind === 'polygon' && Array.isArray(robot.footprint.verticesM)
      ? robot.footprint.verticesM
      : [
        { x: -robot.l / 2, y: -robot.w / 2 },
        { x: robot.l / 2, y: -robot.w / 2 },
        { x: robot.l / 2, y: robot.w / 2 },
        { x: -robot.l / 2, y: robot.w / 2 },
      ];
  }

  function footprintAt(robot, pose) {
    const cosine = Math.cos(pose.headingRad), sine = Math.sin(pose.headingRad);
    return localFootprint(robot).map((point) => ({
      x: pose.x + point.x * cosine - point.y * sine,
      y: pose.y + point.x * sine + point.y * cosine,
    }));
  }

  function polygonBounds(vertices) {
    return vertices.reduce((bounds, point) => ({
      min: { x: Math.min(bounds.min.x, point.x), y: Math.min(bounds.min.y, point.y) },
      max: { x: Math.max(bounds.max.x, point.x), y: Math.max(bounds.max.y, point.y) },
    }), {
      min: { x: Infinity, y: Infinity },
      max: { x: -Infinity, y: -Infinity },
    });
  }

  function boundsPolygon(bounds) {
    return [
      { x: bounds.min.x, y: bounds.min.y }, { x: bounds.max.x, y: bounds.min.y },
      { x: bounds.max.x, y: bounds.max.y }, { x: bounds.min.x, y: bounds.max.y },
    ];
  }

  function pointSegmentDistance(point, first, second) {
    const dx = second.x - first.x, dy = second.y - first.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= EPSILON) return Math.hypot(point.x - first.x, point.y - first.y);
    const ratio = Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / lengthSquared));
    return Math.hypot(point.x - first.x - ratio * dx, point.y - first.y - ratio * dy);
  }

  function axes(vertices) {
    return vertices.flatMap((first, index) => {
      const second = vertices[(index + 1) % vertices.length];
      const dx = second.x - first.x, dy = second.y - first.y, length = Math.hypot(dx, dy);
      return length <= EPSILON ? [] : [{ x: -dy / length, y: dx / length }];
    });
  }

  function projection(vertices, axis) {
    return vertices.reduce((range, point) => {
      const value = point.x * axis.x + point.y * axis.y;
      return { min: Math.min(range.min, value), max: Math.max(range.max, value) };
    }, { min: Infinity, max: -Infinity });
  }

  function convexPolygonClearance(first, second) {
    let minimumOverlap = Infinity, separated = false;
    [...axes(first), ...axes(second)].forEach((axis) => {
      const a = projection(first, axis), b = projection(second, axis);
      const overlap = Math.min(a.max, b.max) - Math.max(a.min, b.min);
      if (overlap < -EPSILON) separated = true;
      else minimumOverlap = Math.min(minimumOverlap, Math.max(0, overlap));
    });
    if (!separated) return -minimumOverlap;
    let minimumDistance = Infinity;
    first.forEach((point) => second.forEach((edge, index) => {
      minimumDistance = Math.min(minimumDistance, pointSegmentDistance(point, edge, second[(index + 1) % second.length]));
    }));
    second.forEach((point) => first.forEach((edge, index) => {
      minimumDistance = Math.min(minimumDistance, pointSegmentDistance(point, edge, first[(index + 1) % first.length]));
    }));
    return minimumDistance;
  }

  function verticalLineSection(vertices, x) {
    const intersections = [];
    vertices.forEach((first, index) => {
      const second = vertices[(index + 1) % vertices.length];
      if (x < Math.min(first.x, second.x) - EPSILON || x > Math.max(first.x, second.x) + EPSILON) return;
      const dx = second.x - first.x;
      if (Math.abs(dx) <= EPSILON) {
        if (Math.abs(x - first.x) <= EPSILON) intersections.push(first.y, second.y);
        return;
      }
      const ratio = (x - first.x) / dx;
      if (ratio >= -EPSILON && ratio <= 1 + EPSILON) intersections.push(first.y + (second.y - first.y) * ratio);
    });
    return intersections.length ? { minY: Math.min(...intersections), maxY: Math.max(...intersections) } : null;
  }

  const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
  const interpolatePose = (first, second, ratio) => ({
    x: first.x + (second.x - first.x) * ratio,
    y: first.y + (second.y - first.y) * ratio,
    headingRad: first.headingRad + wrap(second.headingRad - first.headingRad) * ratio,
  });

  function densePoses(derived) {
    const points = derived.sample.pts, headings = derived.metrics.head;
    if (!points.length) return [];
    const reverseOffset = derived.rev ? Math.PI : 0;
    const poses = [{ x: points[0].x, y: points[0].y, headingRad: (headings[0] || 0) + reverseOffset }];
    for (let index = 1; index < points.length; index += 1) {
      const first = poses[poses.length - 1];
      const second = { x: points[index].x, y: points[index].y, headingRad: (headings[index] || 0) + reverseOffset };
      const steps = Math.max(1, Math.ceil(Math.max(
        Math.hypot(second.x - first.x, second.y - first.y) / 0.08,
        Math.abs(wrap(second.headingRad - first.headingRad)) / (6 * Math.PI / 180),
      )));
      for (let step = 1; step <= steps; step += 1) poses.push(interpolatePose(first, second, step / steps));
    }
    return poses;
  }

  function barrierClearance(poses, robot) {
    let minimum = Infinity, heightValid = true;
    const checkHeight = (section, portals) => {
      const matching = portals.filter((portal) => section.minY >= portal.minY - EPSILON && section.maxY <= portal.maxY + EPSILON);
      if (matching.length === 1 && matching[0].traversal === 'trench'
        && (!Number.isFinite(robot.heightM) || robot.heightM > TRENCH_CLEARANCE_M + EPSILON)) heightValid = false;
    };
    barriers.forEach((barrier) => {
      poses.forEach((pose) => {
        const footprint = footprintAt(robot, pose);
        const footprintBox = polygonBounds(footprint);
        const section = verticalLineSection(footprint, barrier.x);
        const occupied = section || { minY: footprintBox.min.y, maxY: footprintBox.max.y };
        const lateral = barrier.portals.reduce((best, portal) => Math.max(
          best, Math.min(occupied.minY - portal.minY, portal.maxY - occupied.maxY),
        ), -Infinity);
        if (section) {
          minimum = Math.min(minimum, lateral);
          if (Math.abs(pose.x - barrier.x) <= EPSILON) checkHeight(section, barrier.portals);
        }
        else if (lateral < 0) {
          const longitudinal = barrier.x < footprintBox.min.x
            ? footprintBox.min.x - barrier.x
            : barrier.x > footprintBox.max.x ? barrier.x - footprintBox.max.x : 0;
          minimum = Math.min(minimum, longitudinal);
        }
      });
      for (let index = 1; index < poses.length; index += 1) {
        const previous = poses[index - 1], sample = poses[index];
        const left = previous.x - barrier.x, right = sample.x - barrier.x;
        if (left * right >= 0 || Math.abs(sample.x - previous.x) <= EPSILON) continue;
        const ratio = (barrier.x - previous.x) / (sample.x - previous.x);
        const section = verticalLineSection(footprintAt(robot, interpolatePose(previous, sample, ratio)), barrier.x);
        if (!section) continue;
        checkHeight(section, barrier.portals);
        const portalClearance = barrier.portals.reduce((best, portal) => Math.max(
          best, Math.min(section.minY - portal.minY, portal.maxY - section.maxY),
        ), -Infinity);
        minimum = Math.min(minimum, portalClearance);
      }
    });
    return { minimum, heightValid };
  }

  function clearanceReport(path, robot, derived) {
    const poses = densePoses(derived);
    const barrier = barrierClearance(poses, robot);
    let official = barrier.minimum, keepOut = Infinity;
    const keepOutPolygons = (path.keepOuts || []).map(boundsPolygon);
    poses.forEach((pose) => {
      const footprint = footprintAt(robot, pose);
      official = Math.min(official, ...footprint.map((point) => Math.min(point.x, FIELD_W - point.x, point.y, FIELD_H - point.y)));
      obstacles.forEach((obstacle) => { official = Math.min(official, convexPolygonClearance(footprint, boundsPolygon(obstacle))); });
      keepOutPolygons.forEach((region) => { keepOut = Math.min(keepOut, convexPolygonClearance(footprint, region)); });
    });
    return {
      official: Number.isFinite(official) ? official : 0,
      keepOut: Number.isFinite(keepOut) ? keepOut : Infinity,
      minimum: Math.min(official, keepOut),
      heightValid: barrier.heightValid,
      checkedPoses: poses.length,
    };
  }

  window.TrajectoryClearance = { clearanceReport, convexPolygonClearance, footprintAt, fieldModel: { obstacles, barriers } };
})();
