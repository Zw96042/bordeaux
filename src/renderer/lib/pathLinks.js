// Project-local path endpoint links.
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

  function reconcile(project) {
    const paths = project.paths.slice();
    (project.pathLinks || []).forEach((link) => {
    });
    for (const members of graph.groups.values()) seeds.push({ key: members[0], position: graph.members.get(members[0]).waypoint });
    return propagate(project, graph, seeds);
  }

  function linkPosition(project, pathId, index, targetPathId, targetIndex, groupId) {
    const source = project.paths.find((path) => path.id === pathId)?.waypoints[index];
    const target = project.paths.find((path) => path.id === targetPathId)?.waypoints[targetIndex];
    if (!source || !target || (pathId === targetPathId && index === targetIndex)) return project;
    const id = target.positionLink || source.positionLink || groupId;
    if (typeof id !== 'string' || !id.trim()) return project;
    const sourceIndex = project.paths.findIndex((path) => path.id === pathId), targetPathIndex = project.paths.findIndex((path) => path.id === targetPathId);
    const merged = connectedKeys(positionGraph(project), [sourceIndex + ':' + index, targetPathIndex + ':' + targetIndex]);
    const paths = project.paths.map((path, pi) => {
      let changed = false;
      const waypoints = path.waypoints.map((waypoint, wi) => {
        if (!merged.has(pi + ':' + wi)) return waypoint;
        changed = true; return { ...waypoint, positionLink: id };
      });
      return changed ? { ...path, waypoints } : path;
    });
    const linked = { ...project, paths }, graph = positionGraph(linked);
    return propagate(linked, graph, [{ key: graph.groups.get(id)[0], position: target }]);
  }

  function unlinkPosition(project, pathId, index) {
    const pi = project.paths.findIndex((path) => path.id === pathId), waypoint = project.paths[pi]?.waypoints[index];
    if (!waypoint) return project;
    const pathLinks = (project.pathLinks || []).filter((link) => !((index === 0 && link.toPathId === pathId) || (index === project.paths[pi].waypoints.length - 1 && link.fromPathId === pathId)));
    if (!waypoint.positionLink && pathLinks.length === (project.pathLinks || []).length) return project;
    const paths = project.paths.slice();
    if (waypoint.positionLink) {
      const next = { ...waypoint }; delete next.positionLink;
      const waypoints = paths[pi].waypoints.slice(); waypoints[index] = next;
      paths[pi] = { ...paths[pi], waypoints };
    }
    return { ...project, paths, pathLinks };
  }

export const PathLinks = { copyPose, sync, reconcile, linkPosition, unlinkPosition, positionMembers };
