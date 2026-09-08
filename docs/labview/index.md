# LabVIEW integration

Bordeaux authors paths and routines for LabVIEW robot code. Commands come from a linked `.lvproj` and saved NI connector inspection. The desktop contains no robot-language compiler and does not install a robot runtime.

## Path files

Export a selected path as a `.bdx` binary. The [binary format](binary-format.md) fixes byte order, metadata, trajectory samples, follow sections, command arguments and event scheduling fields. The writer has independent byte-layout tests and synthetic golden fixtures. Eventless paths require no command catalog; commanded paths require saved NI parameter type evidence.

## Robot code

Robot integration uses ordinary `.vi` and `.ctl` files alongside team code. Readers decode files, math helpers calculate SI setpoints, and the scheduler returns typed command requests. Caller code supplies measured pose, time, enable/stop state and condition results, then handles motors and command execution. No installed native library is required.

The separate NI construction work is not runtime verification. Neither a catalog nor successful binary export proves the robot-side implementation has been run. Routine authoring remains available in the editor; AQU robot execution is deferred.

## Discovery

See [command discovery](discovery.md) for source inventory and saved NI metadata. Stable IDs connect authoring entries to caller-owned robot handlers. No VI refnum or memory address is serialized into path files.

## Robot delivery

Direct BDX export is available locally. The former JSON trajectory deployment pipeline has been removed. The app cannot report a successful BDX push until a matching BDX receiver, immutable revision readback and disabled-runtime acknowledgment are integrated. Routine documents autosave locally; AQU robot execution remains deferred.
