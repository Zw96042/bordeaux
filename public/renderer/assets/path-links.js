// Project-local path endpoint links. Exports window.PathLinks.
(function () {
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function changed(before, after) {
    return !!before && !!after && ['x', 'y', 'theta', 'thetaOn'].some((key) => before[key] !== after[key]);
  }

  function copyPose(target, source) {
    const next = clone(target), dx = source.x - target.x, dy = source.y - target.y;
    next.x = source.x; next.y = source.y; next.theta = source.theta; next.thetaOn = source.thetaOn;
    if (next.prevC) next.prevC = { x: next.prevC.x + dx, y: next.prevC.y + dy };
    if (next.nextC) next.nextC = { x: next.nextC.x + dx, y: next.nextC.y + dy };
    return next;
  }

  function sync(project, changedId, before) {
    const paths = project.paths.slice(), changedIndex = paths.findIndex((path) => path.id === changedId);
    if (changedIndex < 0 || !before) return project;
    const current = paths[changedIndex], links = project.pathLinks || [];
    const beforeStart = before.waypoints[0], beforeEnd = before.waypoints[before.waypoints.length - 1];
    const start = current.waypoints[0], end = current.waypoints[current.waypoints.length - 1];
    if (changed(beforeEnd, end)) links.filter((link) => link.fromPathId === changedId).forEach((link) => {
      const index = paths.findIndex((path) => path.id === link.toPathId); if (index < 0) return;
      const target = clone(paths[index]); target.waypoints[0] = copyPose(target.waypoints[0], end); paths[index] = target;
    });
    if (changed(beforeStart, start)) links.filter((link) => link.toPathId === changedId).forEach((link) => {
      const index = paths.findIndex((path) => path.id === link.fromPathId); if (index < 0) return;
      const source = clone(paths[index]), last = source.waypoints.length - 1;
      source.waypoints[last] = copyPose(source.waypoints[last], start); paths[index] = source;
    });
    return { ...project, paths };
  }

  window.PathLinks = { copyPose, sync };
})();
