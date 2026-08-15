# Bordeaux planner corpus

`v1` is a frozen, Bordeaux-authored set of synthetic tactical scenarios for the 2026 REBUILT field. It contains no donated paths, private strategy, team identity, commands, credentials, or third-party material, so Bordeaux may redistribute it without seeking outside permission.

The corpus is intentionally useful but modest in what it proves. It covers trench and bump crossings, curved neutral-zone travel, mirrored alliance geometry, an interior stop, and a rolling endpoint for one fixed swerve model. A benchmark may call these representative tactical scenarios; it may not call them real-team, competition-proven, or statistically representative of FRC autonomous strategy.

The project and manifest were frozen before cross-planner results were observed. Any future geometry or scenario change must create a new version directory and digest instead of rewriting `v1`, which prevents a solver result from quietly tuning the benchmark input.

The manifest pins the field, robot, scenario intent, and SHA-256 of the canonical Bordeaux project. Repository tests reject migration, digest drift, team-sensitive content, and baseline geometry that cannot produce a valid trajectory.
