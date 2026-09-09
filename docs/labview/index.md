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

Direct BDX export is available locally. **Push path** uploads the selected path files through SFTP as `lvuser`, using the robot's SSH service on port 22. The default destination is `/natinst/bin/Paths/`; the connection dialog shows an editable directory. Confirm the SSH host key before trusting a new robot. A changed host key requires reconnecting and trusting that robot again.

Review lists the exact filenames and destination before sending. Each file is written to a temporary file, read back, then atomically renamed over its matching filename and read back again. Other files are preserved. Multi-path uploads commit each file separately; if a later transfer fails or is canceled, the error reports already verified files and any uncertain replacement. The account must have write access to the destination; Bordeaux does not change robot permissions.

“Uploaded and verified” means the selected BDX bytes are stored on the robot. It does not require a Bordeaux receiver, acknowledge runtime compatibility, activate a routine, or start execution. LabVIEW code remains responsible for loading and validating the files. Routine delivery, full-project replacement, and runtime pin/rollback are not part of direct file upload. Routine documents autosave locally; AQU robot execution remains deferred.
