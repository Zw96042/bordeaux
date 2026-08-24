# Launch announcement

## Headline

**Bordeaux beta: draw the path, know the run**

## Short deck

Bordeaux is a focused desktop editor for authoring FRC robot paths, autonomous routines, physical constraints, and typed Java command events in one inspectable project.

## Announcement

A robot path is never just a line on a field. It is geometry, timing, heading, drivetrain limits, event markers, and the code that has to agree when autonomous begins.

Today, Bordeaux is available in beta.

Bordeaux brings three connected workspaces into one desktop tool:

- **Plan** — shape splines with waypoints, rotation targets, event markers, local constraint ranges, and timeline playback.
- **Aquitaine** — compose complete autonomous routines from paths, commands, waits, stationary actions, and sensor decisions.
- **Robot** — describe the drivetrain, bumper footprint, geometry, gearing, mass, units, and physical limits used to preview and bound motion.

For Java teams, Bordeaux can install managed support files after a preview, discover annotated command factories through a deterministic catalog, validate typed arguments, and export a versioned JSON contract. It does not edit `RobotContainer`, and it does not deploy robot code.

Agent access is optional and off by default. When enabled, planning produces a small ranked set of bounded candidates. Every proposed change remains staged behind explicit Apply and Reject controls in the editor.

Bordeaux is beta software. Teams should validate every exported trajectory in simulation and on a safely controlled robot, and keep a known-good autonomous fallback for competition.

Download the current beta and read the release notes: <https://github.com/Zw96042/bordeaux/releases>

Browse the source or report an issue: <https://github.com/Zw96042/bordeaux>

**Draw the path. Know the run.**
