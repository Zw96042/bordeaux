# LabVIEW integration

Bordeaux authors paths and routines for LabVIEW robot code. Commands come from a linked `.lvproj` and saved NI connector inspection. The desktop contains no robot-language compiler and does not install a robot runtime.

## Path files

Export a selected path as a `.bdx` binary. The [binary format](binary-format.md) fixes byte order, metadata, trajectory samples, follow sections, command arguments and event scheduling fields. The writer has independent byte-layout tests and synthetic golden fixtures. Eventless paths require no command catalog; commanded paths require saved NI parameter type evidence. Event records resolve GUI IDs through those descriptors to original command VI basenames for the existing dynamic wrapper dispatcher (`bordeaux-dynamic-wrappers/1`). Old files containing hashed command IDs must be re-exported. Only markers with command invocations produce events; an eventless path runs no event commands.

This export profile supports time markers, optional time repeats, scalar arguments and saved defaults. Conditional/position markers, position-follow sections, automatic path-end cancellation, arrays and clusters are rejected explicitly. Wrappers remain reentrant VIs included by static reference for deployment and resolved dynamically by robot code; Bordeaux requires no catalog VI or filename mapping.

## Robot code

Robot integration uses ordinary `.vi` and `.ctl` files alongside team code. Readers decode files, math helpers calculate SI setpoints, and the scheduler returns typed command requests. Caller code supplies measured pose, time, enable/stop state and condition results, then handles motors and command execution. No installed native library is required.

The separate NI construction work is not runtime verification. Neither a catalog nor successful binary export proves the robot-side implementation has been run. Routine authoring remains available in the editor; AQU robot execution is deferred.

## Discovery

See [command discovery](discovery.md) for source inventory and saved NI metadata. Stable IDs connect authoring entries to caller-owned robot handlers. No VI refnum or memory address is serialized into path files.

## Robot delivery

Direct BDX export is available locally. **Push path** uploads the selected path files through SFTP as `lvuser`, using the robot's SSH service on port 22. The default destination is `/home/lvuser/natinst/bin/Paths/`, matching the LabVIEW autonomous loader. Saved connections using the former `/natinst/bin/Paths` default are corrected when loaded; other custom directories are preserved. The destination is shown before every upload. Directory links are followed, as with a normal file copy. Bordeaux uses the OpenSSH rename extension when available; a server without it uses standard SFTP rename for new files and a direct overwrite for an existing selected file. Direct overwrites are not atomic: an interrupted copy can leave that selected file incomplete. Final readback still verifies the bytes, and a failure names the transfer step and reports which files were verified. Other files are never removed.

Set up the robot once and confirm its SSH identity. Subsequent pushes go directly to the selected-file review with the saved robot and directory; no separate connection or trust step is required. **Edit destination** keeps the selection and reuses the known identity if the address and SSH key still match. A different robot or changed key requires identity confirmation. After a failed upload, **Review and retry** prepares current selected paths using the remembered robot. Connection checks report missing required parent directories before trust; only missing descendants inside the allowed upload area are created during upload.

In **Settings → Robot connection**, **Edit connection → Save settings** stores the address, port and destination locally without connecting. Directory-only edits retain the remembered SSH identity; changing the host or port clears it and requires **Connect** and identity review before a push. Saving settings discards any prior upload review; select paths and review the destination again when ready to send.

Review lists the exact filenames and destination before sending. Each file is written to a temporary file, read back, then published at its matching filename and read back again. Publication uses an atomic rename when supported, or the selected-file copy fallback described above. Other files are preserved. Multi-path uploads commit each file separately; if a later transfer fails or is canceled, the error reports already verified files and any uncertain replacement. The account must have write access to the destination; Bordeaux does not change robot permissions.

For selecting a complete path and converting BDX field velocities into the legacy swerve coordinate system, see [robot playback integration](robot-playback-integration.md).

“Uploaded and verified” means the selected BDX bytes are stored on the robot. It does not require a Bordeaux receiver, acknowledge runtime compatibility, activate a routine, or start execution. LabVIEW code remains responsible for loading and validating the files. Routine delivery, full-project replacement, and runtime pin/rollback are not part of direct file upload. Routine documents autosave locally; AQU robot execution remains deferred.
