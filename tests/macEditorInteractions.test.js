import { describe, it, expect } from 'vitest';
import { createDemoProject } from '../src/shared/project/defaults';
import { PathLinks } from '../src/renderer/lib/pathLinks';
import { replaceEditedPath } from '../src/renderer/app/App';
import { metricColor, metricGradient } from '../src/shared/math/metricDisplay';

describe('Mac editor linked waypoint identity', () => {
  it('names every occurrence after its named source and propagates edits in either direction', () => {
    let project = createDemoProject();
    const base = project.paths[0];
    project.paths = ['original', 'second', 'third'].map((id) => ({ ...structuredClone(base), id, name: id }));
    project.paths[0].waypoints[1].positionName = 'test';
    project = PathLinks.linkPosition(project, 'second', 0, 'original', 1, 'shared-test');
    project = PathLinks.linkPosition(project, 'third', 1, 'second', 0, 'unused');
    for (const [pi, wi] of [[0, 1], [1, 0], [2, 1]]) expect(PathLinks.waypointName(project, project.paths[pi], wi)).toBe('test');
    for (const [pi, wi, x, y] of [[1, 0, 5, 4], [0, 1, 6, 3], [2, 1, 4, 2]]) {
      const edited = structuredClone(project.paths[pi]);
      edited.waypoints[wi] = PathLinks.copyPose(edited.waypoints[wi], { x, y });
      project = replaceEditedPath(project, edited);
      for (const [memberPath, memberIndex] of [[0, 1], [1, 0], [2, 1]]) expect(project.paths[memberPath].waypoints[memberIndex]).toMatchObject({ x, y });
    }
    const renamed = structuredClone(project.paths[0]); renamed.waypoints[1].positionName = 'New name';
    project = replaceEditedPath(project, renamed);
    expect(PathLinks.waypointName(project, project.paths[1], 0)).toBe('New name');
  });
  it('falls back to endpoint names and uses a point’s explicit name first', () => {
    const project = createDemoProject(), path = project.paths[0];
    expect(PathLinks.waypointName(project, path, 0)).toBe('Start');
    expect(PathLinks.waypointName(project, path, path.waypoints.length - 1)).toBe('End');
    path.waypoints[0].positionName = 'Intake';
    expect(PathLinks.waypointName(project, path, 0)).toBe('Intake');
  });
});
describe('velocity display', () => {
  it('uses one continuous luminance ramp for the field and legend', () => {
    const levels = Array.from({ length: 101 }, (_, i) => metricColor('velocity', i / 100).match(/\d+/g).map(Number));
    for (let i = 1; i < levels.length; i++) {
      for (let channel = 0; channel < 3; channel++) {
        expect(levels[i][channel]).toBeGreaterThanOrEqual(levels[i - 1][channel]);
        expect(levels[i][channel] - levels[i - 1][channel]).toBeLessThanOrEqual(3);
      }
    }
    expect(metricGradient('velocity')).toContain('#31516e 0%');
    expect(metricGradient('velocity')).toContain('#a2e3eb 100%');
  });
});
