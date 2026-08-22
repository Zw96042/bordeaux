# Heading priority and blend semantics

Research date: 2026-08-19

## Conclusion

Bordeaux no longer exposes a heading-versus-translation priority. Choreo represents waypoint and segment requirements as constraints, solves translation and heading together, and minimizes the sum of all sample durations. Bordeaux now follows that product model: authored translation and heading are one coupled motion, and the planner retimes the path only as required by the robot's angular, module-speed, force, and traction limits.

Older project files may still contain priority metadata. It is accepted for compatibility, removed during normalization, and has no planning effect.

For the normal heading-law transition, the waypoint is sufficient as the transition anchor. Bordeaux can use that waypoint as the point where the new heading law starts, then follow it as quickly as the coupled drivetrain and physical limits allow. A separate **Before / At / After** control is only justified when the author explicitly wants a stronger rule such as "finish acquiring it before this waypoint." It is not required for ordinary blending and is not present in Choreo's waypoint model.

## Evidence

### Translation and rotation share the drivetrain's physical capacity

Choreo optimizes chassis translation, heading, linear/angular velocity and acceleration, module forces, and interval duration as decision variables in one problem. It integrates translational and angular state together between samples. ([Choreo swerve generator, state variables and kinematics](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/trajoptlib/src/swerve_trajectory_generator.cpp#L68-L108), [joint kinematics](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/trajoptlib/src/swerve_trajectory_generator.cpp#L169-L210))

The module velocity constraint is built from both chassis translation and angular velocity. The same bounded module forces produce both net translation force and net torque. Therefore arbitrary translation and rotation cannot both be treated as independently free, even on a holonomic drivetrain. ([module velocity and force limits](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/trajoptlib/src/swerve_trajectory_generator.cpp#L235-L267), [shared force/torque dynamics](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/trajoptlib/src/swerve_trajectory_generator.cpp#L270-L277))

This is why Bordeaux must solve the two requests together rather than pretending translation and rotation have independent capacity.

### Choreo minimizes time without a heading/translation priority toggle

Choreo explicitly minimizes the sum of the per-sample durations. ([time objective](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/trajoptlib/src/swerve_trajectory_generator.cpp#L121-L168)) Its official documentation describes it as a time-optimal planner that uses drivetrain performance while obeying dynamics constraints. ([Choreo overview](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/docs/index.md#L8-L18))

Choreo's trajectory schema has fixed-translation and fixed-heading waypoint flags plus hard constraint types, but no rotation-priority field. ([waypoint and constraint schema](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/src-core/src/spec/trajectory.rs#L8-L38), [constraint variants](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/src-core/src/spec/trajectory.rs#L99-L156)) Conflicting hard constraints can cause generation to fail rather than silently choosing one. ([constraint behavior](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/docs/usage/editing-paths.md#L59-L64))

Sleipnir only supplies the scalar objective and equality/inequality-constraint machinery. Choreo supplies the drivetrain model and the total-time objective. ([Sleipnir problem formulation](https://github.com/SleipnirGroup/Sleipnir/blob/0dacf975878c38d293daa305401ac8482ee5e043/include/sleipnir/optimization/problem.hpp#L43-L63), [`minimize()` and `subject_to()`](https://github.com/SleipnirGroup/Sleipnir/blob/0dacf975878c38d293daa305401ac8482ee5e043/include/sleipnir/optimization/problem.hpp#L142-L234))

### The waypoint can be the blend anchor

In Choreo, a pose waypoint fixes both translation and heading at that waypoint, while a translation waypoint fixes only position and leaves heading to another constraint or the optimizer. ([official waypoint semantics](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/docs/usage/editing-paths.md#L18-L32), [pose equality implementation](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/trajoptlib/include/trajopt/constraint/pose_equality_constraint.hpp#L25-L40))

There is no independent Before / At / After transition-placement property in Choreo's waypoint schema. More specific authoring intent is expressed with waypoint- or segment-scoped constraints such as Point At. ([constraint scopes](https://github.com/SleipnirGroup/Choreo/blob/764ff38cf93592deb8d1fb32921fdb8bbcce4aee/docs/usage/editing-paths.md#L65-L100))

The important distinction is that the waypoint should anchor the **requirement**, not force a discontinuous heading jump. Actual heading, angular velocity, and angular acceleration remain continuous and dynamically constrained; the optimizer decides when rotation must begin or may finish.

## Product decision

1. Use the waypoint as the automatic transition anchor; do not expose Before / At / After.
2. Remove priority controls from transitions and constraint ranges.
3. Treat tangent, manual, target, and look-at headings as part of the trajectory definition and solve them with translation.
4. Keep module-speed, torque, traction, angular-velocity, and angular-acceleration limits hard.
5. Normalize legacy priority metadata away so old files remain readable without preserving two planning modes.
