# Robot playback: path selection and drive coordinates

This guide follows the September 12 robot test and read-only inspection of the
updated XPS `Autonomous.vi`, `Auto Play Path.vi`, `NEO Swerve Drive.vi`,
`Pigeon2 Field Centric.vi`, `Field To Robot Centric.vi`, and
`Swerve IMU Orientation Correction.vi`. Existing caller wiring still needs a
manual LabVIEW edit. Neither this guide nor source tests establish robot runtime
behavior.

## Select one complete path before playback

The loading loop iterates over **paths**; the timed playback loop iterates over
**time**. An auto-indexing input tunnel on the timed loop consumes a different
path each tick and eventually produces empty/default data. The first trajectory
sample can itself have zero velocity, explaining the observed first-zero then
empty behavior.

The updated diagram removes that tunnel indexing but still uses default-zero
Index Array inputs to choose the first path. For a durable interface:

1. Inside the file-loading For Loop, bundle one complete path: identity,
   Samples[], EventBlocks[], metadata/follow configuration, and load validity.
2. Auto-index that **cluster** through the loading loop's output to create
   PathData[]. The sample/event arrays remain inside their own path cluster;
   do not concatenate or pad trajectories of different lengths into a matrix.
3. Resolve the chosen stable path ID to exactly one PathData entry. A numeric
   index can be the internal result, but reject missing, duplicate, negative,
   and out-of-range selections before playback.
4. Pass that selected cluster to Auto Play Path before its timed loop. Unbundle
   it once and pass complete arrays through non-indexing input tunnels. Keep the
   selected path fixed for the whole run. The sample-time helper chooses the
   current sample; the loop iteration never chooses the path.
5. Use a separate outer sequencer for several paths. Wait for actual successful
   completion, then choose the next path and initialize its playback and command
   state. The current Auto Done output is set on loop exit; it alone does not
   distinguish successful completion from disable, stop, or fault. Check the
   time-step Finished/Valid flags and absence of cancellation/clock fault.

PathRun is a new execution generation, separate from path identity or list
position. Do not reset continuous localization at every path transition. Test
two paths with unequal sample/event counts and different first velocities; each
should retain its own arrays throughout its run.

## Keep field-centric rotation in the drive command

Updated September 13 at the user's request: NEO Swerve Drive remains the owner
of IMU acquisition and field-to-robot rotation. Use **BDX Field To Legacy
Axes.vi**, the three-input adapter, for this arrangement. The earlier four-input
BDX Field To Legacy Drive.vi performs its own rotation and is an alternative;
**do not chain it with this adapter or an enabled NEO field-centric conversion**.

BDX time-step outputs are field-frame VX/VY in meters/second and counterclockwise
omega in radians/second. The legacy drive expects field X-right and Y-forward
in feet/second, with clockwise-positive omega in degrees/second before its
internal field-centric rotation.

The axes-only adapter computes:

```text
Legacy field X = -BDX field VY / 0.3048
Legacy field Y =  BDX field VX / 0.3048
Legacy omega   = -BDX omega * 180 / pi
```

The command conversion uses no heading or trigonometry and performs no sensor
read or gyro reset.
It returns the three values in that order and a Boolean Valid. Nonfinite inputs
or conversion overflow produce three zeros and Valid=False.

### Caller wiring

1. Connect the time-step's VX, VY, and Omega directly to the three scalar inputs
   of BDX Field To Legacy Axes.vi. Remove the old positive-only multipliers.
2. Index its three outputs into the actual Robot Velocities cluster's X, Y,
   and omega fields. Preserve existing stop, disable, preflight, sensor-health,
   and velocity-limit checks; require the adapter's Valid before motion.
3. Keep **Field Centric=True** in Drive Conditions passed to NEO Swerve Drive.
   NEO already reads the IMU and rotates translation. Its separate Auto Align
   Boolean is not the Field Centric setting.
4. Do not add another field-to-robot rotation upstream, and do not use the older
   four-input adapter in this wiring.
5. Remove the temporary initial `pathStartHeading - 90 degrees` workaround as
   part of the coordinated axes and heading-alignment change below.

### Initial IMU heading and sign

The inspected Pigeon2 Field Centric.vi negates raw yaw. Field To Robot Centric.vi
then converts that effective heading from degrees to radians and subtracts it
from the velocity's polar angle. For the axes-only adapter, that **effective
heading must equal canonical measured robot heading** in the path's field frame.

Consequently, if these wrappers remain unchanged, their raw yaw must be
`-canonicalHeadingDegrees`. Initializing the same raw yaw reference with
`-firstSample.RobotHeading * 180/pi` gives the right initial alignment, provided
that the robot is actually placed at that heading. Use Robot Heading, not
Travel Heading. Do not add or subtract 90 degrees.

This initialization is conditional on the actual setter/getter correspondence
and dynamic gyro sign. On a physical counterclockwise turn, canonical heading
must increase; with the inspected negating wrapper, raw yaw must decrease.
If it increases instead, correct the yaw-sign boundary and matching seed
convention together. A starting offset cannot repair a wrong dynamic sign.
Do not change shared teleop gyro behavior without checking its callers.

### One heading feedback owner

Swerve IMU Orientation Correction is a separate controller: its inspected graph
negates measured yaw, wraps degrees, and optionally adds PID output to omega.
Keeping field-centric rotation inside NEO does not require changing that
controller, but its target and measurement must use matching heading conventions.
Do not leave an enabled heading controller at an unintended zero setpoint or
run it alongside a second heading controller. For an isolated coordinate check,
bypass heading PID and use trajectory omega feedforward; later assign heading
feedback to one controller deliberately.

### Numerical checks through the complete chain

| Effective measured heading | BDX field command | Expected robot-relative legacy command after NEO rotation |
| --- | --- | --- |
| 0 | VX=1, VY=0, omega=0 | X=0, Y=+3.28084, omega=0 |
| 0 | VX=0, VY=1, omega=0 | X=-3.28084, Y=0, omega=0 |
| +90 degrees | VX=1, VY=0, omega=0 | X=+3.28084, Y=0, omega=0 |
| any finite | VX=0, VY=0, omega=+1 rad/s | X=0, Y=0, omega=-57.29578 deg/s |

The source tests model the actual captured negate-yaw/polar-rotation chain and
use fresh straight/curved Bordeaux binary writer output. This proves the
mathematical composition, not physical gyro sign, native numerical execution,
or robot direction. Inspect sensor values and pod targets before driving.

## Push destination

Use `/home/lvuser/natinst/bin/Paths`, matching the inspected Autonomous loader.
The Electron upload flow remembers the robot and destination, reviews only the
selected immutable path files, and verifies their bytes after transfer. It does
not select or execute an autonomous routine. See [the delivery workflow](index.md).
