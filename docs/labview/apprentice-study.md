# Apprentice project study — 2026-09-07

**Architecture correction:** The new BDX reader/runner will be direct LabVIEW VIs in this project. Prior native-library/ABI proposals below are historical and superseded; no new runtime library is part of this pass. All AQU work is deferred.

Saved from the XPS project study. The normative storage contract is [binary-format.md](binary-format.md); evidence paths below are relative to the preserved XPS workspace unless an absolute root is given. **Latest scope is BDX only; all AQU work is deferred.**

This is the consolidated current context. Historical contradictory wording is preserved in context-history/structure-before-consolidation.md and is not current guidance. Evidence is diagram-based where explicitly stated; filenames are never proof of behavior. Scope: new binary BDX reading and standalone path execution with typed command events; AQU is entirely out of scope, including storage/readback. Actual new NI VIs and NI fixture execution remain unfinished.

## Exact source identity and preservation

Define these absolute roots for all relative paths below:

- R = C:\Users\zwatx\Developer\LabView\2026\rebuilt-2687\Robot Code
- S = C:\Users\zwatx\Developer\LabView\2026\rebuilt-2687\swerve-template
- P = C:\Users\zwatx\Developer\LabView\2026\rebuilt-2687\bordeaux-2687-rebuilt\Bordeaux
- W = C:\Program Files (x86)\National Instruments\LabVIEW 2025\vi.lib\Rock Robotics\WPI\Framework
- Workspace = C:\Users\zwatx\codex-workspaces\apprentice-runtime-20260907

Selected originals: R\RebuiltApprentice.lvproj (robot Target), P\Trajectory.lvproj (reference planner). LabVIEW2025 process12556/session1 was last reverified during the prior checkpoint; refresh before any automation binding. No Run/save/target connection/build/deploy or actuator work has occurred in the team project. Open unsaved originals remain untouched; disk backup does NOT capture their in-memory edits.

source-backup/20260907-initial/manifest.json records1356files with original/backup paths and before/copy/after hashes. integration-source/ preserves the same R/S/P relative hierarchy; evidence/integration-source-preservation.json verified all1356baselinefiles unchanged. An earlier native support bundle was staged in the integration copy as a prototype; it is not a dependency of the current direct-VI BDX implementation.

## Evidence provenance

- evidence/fresh-ni/*.png: real approved Computer Use captures of original RebuiltApprentice.lvproj/Target windows during this task. They are observations of in-memory diagrams, not a guarantee of saved disk revision.
- evidence/prior-ni/:74preserved NI print artifacts; evidence/prior-ni-manifest.json records provenance/hashes. Source was C:\Users\zwatx\codex-workspaces\labview-host-setup-20260907\product-reference. complete.txt files hold original paths/types/revisions. Representative prior revisions: Autonomous339, Play Path22, Auto Play Path78, Parse Auto Data79, Sequence Commands3. Do not infer these are today's saved or unsaved revision.
- evidence/old-binary/: actual Versioned Write print diagrams/control metadata. legacy-bdx-structure.md and evidence/legacy-bdx-inspection.json record partial binary decoding and exact offsets/asset hashes. No Versioned Load diagram has yet been captured.

## Verified call chain and selector

1. R\Autonomous.vi: prior trajectory/Autonomous/completed.png and completed2.png. Reads NetworkTables /CU-DB/Auto Selector. Manual/default reads /CU-DB/Auto Paths string array. Its old case named Aquitaine reads /CU-DB/Aquitaine string and a string spreadsheet/file list, column0. This is not a current Bordeaux routine graph interpreter; new AQU execution is deferred.
2. Autonomous contains path derivation from VI location and RUN_TIME conditional target path /home/lvuser/natinst/bin/Paths. Per file it calls R\Support Code\Parse Auto Data.vi and preprocessing, combines arrays, initializes IMU yaw, sets Drive Conditions and calls R\Drive\Commands\Play Path.vi with synchronization Wait. Static references retain11commandwrappers. Separate20msloop reports autonomous mode; annotation says Autonomous is terminated automatically at period end. The exact independent mode-stop owner is still unverified.
3. R\Drive\Commands\Play Path.vi: bundles Auto Data into R\Drive\Implementation\Drive Setpoints.ctl; W\Prep Command Info for Wait.vi -> R\Drive\Implementation\Infrastructure\Drive Command Helper.vi -> W\Wait for Command.vi. Synchronization feeds prepare and wait. R\Framework\Robot Global Data.vi Auto Done? is cleared. The WPI prepare/wait internals are not yet fully audited.
4. R\Drive\Implementation\Drive Controller.vi, Auto case: FRESH VERIFIED (drive-controller-auto.png). Synchronous R\Drive\Commands\Auto Play Path.vi call inside an eligibility case, then Finished -> R\Drive\Implementation\Infrastructure\Drive Check for New Command.vi with100mswait. The exact eligibility comparison is not yet certified. That100mswait is outside the synchronous path VI and cannot interrupt it while running.
5. Drive Check for New Command: FRESH VERIFIED (drive-check-command-finished.png and drive-check-command-not-finished.png). Finished=true selects Successful and schedules Default. Otherwise queue timeout leaves Incomplete; replacement command selects Aborted. Successful/Aborted path sends old command notifier, resets time/iteration and updates command state. New abort/error must not simply feed Finished=true into the existing success route.
6. R\Drive\Commands\Auto Play Path.vi: fresh auto-play-path-loop.png plus prior complete prints. Named Command Queue and R\Drive\Implementation\Command Sequencer Infrastructure\Sequence Commands.vi. Timed loop20ms,1kHzsource,priority100,offset-2. Selects/samples ordinary or Choreo path data, invokes velocity selector, optional vision correction, S\Hardware VIs\Swerve IMU Orientation Correction.vi, Drive Conditions output scaling and S\Hardware VIs\NEO Swerve Drive.vi. Exit ORs index exhaustion, Robot Mode != Autonomous Enabled, Operation != Auto. Two post-loop NEO Set Output calls receive zero arrays in Percent VBus; Auto Done? becomes true for every exit. Queue sentinel -1 is present; full sentinel/release ordering and ownership still need verification. Clock icons/U32 subtraction are observed; primitive identity/epoch/wrap handling remain unverified.
7. R\Drive\Implementation\Command Sequencer Infrastructure\Sequence Commands.vi: dequeues, checks error/sentinel/time, invokes Optimized Call Command.vi, reports name/time. Optimized Call Command.vi sets indexed controls then invokes Run VI. Wait Until Done and Auto Dispose Ref have no explicit wires in the inspected print; their defaults are NOT assumed.
8. R\Drive\Implementation\Command Sequencer Infrastructure\Preprocess Commands.vi: rewrites .vi to _wrapper.vi, opens by name with option hex8, resolves GetControlIndexByName, stores VI ref/I32indices/Variantvalues. Start Intake wrapper print has typed mirrored controls but no wired connector pane. Dynamic control index is not the connector terminal index. Binding must preserve both mechanisms explicitly; there is no verified uniform connector dispatcher.

## NI data contracts actually observed

Auto Data is a cluster of7members (Play Path/Auto Play Path complete.txt):

| Member | NI shape |
|---|---|
| Velocities |1Darray of S\Type Definitions\Data\Robot Velocities.ctl: X Velocity,Y Velocity,Rotational Velocity, allDBL |
| Positions |1Darray {x,y,th}, allDBL |
| Commands |1Darray {time/position DBL, Command out {Name string,genericVIref,I32controlindices[],Variantvalues[]}} |
| Zero Velocity? |Booleanarray |
| dt array |DBLtimestamp array |
| Auto Align |Booleanarray |
| Choreo Sample |array {timestamp,x,y,th,x,y,Omega,ax,ay,alpha,fx[],fy[]},DBL fields |

W\Command Status Info.ctl contains Name string, Status U16 enum {Successful,Aborted,Incomplete}, notifier reference. Related W\Completion Status.ctl and W\Completion Notifier.ctl paths appear in actual print dependencies. A status pair identifies a command candidate, not a verified executable binding. Exact terminal/control indexes, saved typed defaults, raw type/typedef identity and all adapter behavior require verification.

The11wrapperpaths retained by the selected source are:

- R\Climb\Commands\Climb Immediate_wrapper.vi
- R\Drive\Commands\Config Drive Pipeline Command_wrapper.vi
- R\Hopper\Commands\Hopper Immediate_wrapper.vi
- R\Intake\Commands\Intake Immediate_wrapper.vi
- R\Intake\Commands\Start Intake_wrapper.vi
- R\Pivot\Commands\Extend Pivot Auto_wrapper.vi
- R\Pivot\Commands\Pivot Immediate_wrapper.vi
- R\Pivot\Commands\Retract Pivot Auto_wrapper.vi
- R\Shooter\Commands\Shooter Immediate_wrapper.vi
- R\Shooter\Commands\Start Popcorn_wrapper.vi
- R\Transfer\Commands\Transfer Immediate_wrapper.vi

Their differing execution settings are intentional per user. Reentrancy, clone allocation, priority, preferred execution system and dynamic invoke defaults remain UNVERIFIED individually. Do not normalize them or mark candidates runtimeReady. Historical binding-profile examples are synthetic prototype evidence. The new ordinary VI resolver must use actual saved NI command types/defaults and compiled command definitions; no runtime profile installation is required.

## Loader and storage boundary

R\Support Code\Parse Auto Data.vi calls P\FileIO\Versioned Load.vi in its active diagram. Old parser applies90degreeoffsets, degree-in/out -180..180 wrap, (x/180)*pi conversion, Cartesian rotation and alliance scalar. Blue case yields+1; Invalid falls back to Is Blue Alliance? selecting+1/-1. A separate graph integration uses0.02. Choreo load/cache VIs are in a DISABLED structure with empty sample constant; .traj assets alone do not establish active use. Exact full alliance convention remains to be traced before new controller integration.

P\FileIO\Versioned Write.vi actual diagram writes version string4.5 then explicitly wired fields through sequential binary writes; input-cluster member order is not serialization order. All241oldBDXassets examined have big-endian U32length3 plus ASCII4.4, twoBooleanbytes then trajectory array. Commands include private NI Variants/icons. Read legacy-bdx-structure.md for full observed9member input and nested trajectory/command types. Versioned Load migration4.4/4.5 semantics remain unknown; do not infer which version added Auto Align.

The current normative storage contract is [binary-format.md](binary-format.md): BDXLV1 magic, 32-byte big-endian version/length/CRC header, explicit metadata/sample/follow/event sections and exact NI primitive arguments. The reader uses ordinary NI primitives and VIs; there are no native decode/session handles, CLFN calls or installed binding profiles. The app exports exactly one selected path locally. All AQU work is deferred.

App output includes canonical planner travel heading separately from robot heading, nondecreasing sample times with bounded stationary duplicate handling, and authored event schedules. A command catalog hash identifies saved NI definitions for comparison against actual compiled resolver constants; it does not assert executable readiness. The app-generated golden files are synthetic interoperability fixtures, not evidence that real NI execution works.

## Drive units, transforms and feedback

- R\Support Code\Utils\Adjust Velocities w Interp.vi (adjust-velocities-selector.png) is two selects controlled by Choreo Traj?. It chooses ordinary Position/RobotVelocities versus Choreo sample members. No interpolation/PID/pose feedback in this VI.
- S\Hardware VIs\Swerve IMU Orientation Correction.vi (imu-heading-correction.png) gets Pigeon YawPitchRoll, negates yaw (Negate primitive confirmed by Context Help), wraps measured yaw and setpoint degrees in/out -180..180, runsPID, selects correction or0 via IMU Correction?, adds to incoming rotation; XYpass through. Observed panel gains7/0/0 and range[-330,330] are not certified saved defaults. Exact rotational velocity unit through downstream kinematics remains unresolved.
- S\Hardware VIs\NEO Swerve Drive.vi (neo-swerve-drive.png) includes feedback/config, optional Auto Align?/Point to Hub override of rotation, Field Centric conditional -> Pigeon2 Field Centric.vi, inverse kinematics, optimization, pod setpoints and Set Pod. Pod setpoint labels areft/s anddegrees; hardware radii explicitlyfeet. That does not certify every upstream angular conversion/sign.
- S\Hardware VIs\Pigeon2 Field Centric.vi (pigeon-field-centric.png) negates Pigeon yaw then calls S\math\Field To Robot Centric.vi (field-to-robot-math.png). Degree input wraps to radians[-pi,pi]; XYspeed+atan2angle minus heading -> sin/cos rectangular conversion. Rotation passes through. Reuse this transform or match it exactly ONCE; do not double-rotate field velocity.
- Direct BDX samples use SI field coordinates and separate robot/travel heading. The NI implementation must keep measured fraction independent of lookahead/reference progress, establish measured pose validity/freshness and preserve the actual team drive controller boundary. Prior native follower behavior is reference evidence only, not an active dependency.

## Exact unresolved items required before runtime readiness

1. Measured pose source: both R\Pose Estimator State.vi AND R\Drive\Pose Estimator State.vi exist; do not silently choose one. Inspect R\Drive\Commands\Odometry.vi, R\Drive\Pose Measurement.ctl, R\Drive\EKF Correct Pose.vi and only needed call chain. Determine units, axes/alliance frame, update age/reset/discontinuity/validity behavior. Related coordinate candidates R\Drive\Commands\Bordeaux to Botpose Convert Coordinates.vi and BotPose Coords to Map Coords.vi have not been certified by filename.
2. S\math\Inverse Kinematics.vi and Inverse Kinematics Solution to Pod Setpoints.vi: exact angular input units/sign, speed conversion and saturation. Close old parser/alliance transform trace and decide one new-SI boundary.
3. All11wrapperExecutionproperties, true control/connector indexes/defaults, dynamic VI Run defaults, clone/ref lifetime and WPI prepare/wait/cancel behavior. Use rawNIreport/cache as evidence only; normalized scalar schemas loseNIwidths.
4. R\Robot Main.vi and actual mode/subsystem owner: independent stop hook surviving Autonomous termination. Full stop must inhibit dispatch/increment generation first, cancel all autonomy-dispatched commands (including cancelOnPathEnd=false events), resolve Aborted/error distinctly, zero drive, release owned queues and references. Path-end cleanup alone does not cancel every autonomy-dispatched command.
5. P\FileIO\Versioned Load.vi actual version cases and full queue/sentinel/ref cleanup. No new old-format decoder is planned; preserve old route.
6. Scoped MCP dependency/startup/stop/loopback inspection and real tool schema; arithmetic-only authoring/save/reopen/error-list fixture before the direct reader. Then hardware-free reader/typed command/stop fixtures. None has run yet.

## Current implementation state

The owner manually installed the dependencies and had an agent open the SDK example successfully. The XPS implementation worker confirmed the example opens, recovered off-screen windows with Computer Use and opened the actual scripting project. The owner resolved the User Events typedef selection. The NI Error List now confirms missing DQMH Module Admin and Enqueue Message dependencies. The matching DQMH Framework: Palette 7.1.2 package is open in VIPM for LabVIEW 2025; the install dialog failed Computer Use activation, and a precise manual installation request is pending. A fresh SDK download under Downloads was identified separately from the actual VI-authoring repository. Both app grants were already approved, and the earlier installer dialog is resolved.

The Mac direct BDX writer, production local export workflow and matching golden files passed focused tests, full app build and independent source/workflow review. Real NI reader/runner compile, reopen and desktop harness evidence remain required. No team-project or physical-robot run is claimed by the app checks.
