## 100-word boilerplate

Bordeaux is a desktop authoring environment for FRC autonomous work. Its Plan workspace combines waypoints, headings, rotation targets, event markers, local constraints, and timeline playback. Aquitaine composes paths with commands, waits, stationary actions, and sensor decisions, while the Robot workspace defines drivetrain geometry and physical limits. A managed Java integration discovers annotated command factories and exports a versioned, validated JSON contract without editing `RobotContainer` or deploying robot code. Optional local MCP access is disabled by default, and every agent proposal remains behind Apply/Reject controls. Bordeaux is currently beta and should be validated in simulation and on a safely controlled robot.

## Fact sheet

- Product: Bordeaux
- Category: FRC path and autonomous routine authoring
- Current version in this kit: `0.2.0-beta.2`
- Maintained language target: Java 17
- Packaging targets in the repository: macOS, Windows, Linux
- Workspaces: Plan, Aquitaine, Robot
- Agent access: local MCP, off by default
- Change control: proposals require explicit Apply or Reject
- Java boundary: installs managed support after preview; does not edit `RobotContainer`; does not deploy
- Source: https://github.com/Zw96042/bordeaux

## Suggested attribution

“Bordeaux” with a capital B. Use “FRC path and autonomous routine editor” on first reference. Do not describe the bounded planner as globally optimal, the Java integration as deployment, or agent proposals as self-applying.

## Public contact route

- Project: Zachary Wilson / Bordeaux
- Questions and issues: https://github.com/Zw96042/bordeaux/issues
- Website: https://bordeaux.wilsonzach.com/

Add a monitored media email before direct press outreach; do not publish a private address by default.
