import { decodeLabviewNiInspection } from '../../src/electron/labviewNiTypes';
import { bdxBindingsFromCatalog } from '../../src/electron/bdxBindings';
import { routineBindingsFromBinary } from '../../src/electron/routineBindings';
import { binaryWriterFixture } from './binaryWriterFixture';

// Synthetic NI connector records. These bytes do not certify any real robot VI.
const status = (name: string) => `<Cluster><Name>${name}</Name><NumElts>3</NumElts><String><Name>Name</Name></String><EW><Name>Status</Name><Choice>Successful</Choice><Choice>Aborted</Choice><Choice>Incomplete</Choice></EW><Refnum><Name>notifier out</Name><RefKind>Notifier</RefKind></Refnum></Cluster>`;
const metadata = (name: string) => [[[[name], 'C:\\Test\\Command Status Info.ctl', false, 0, []]]];
export function routineRuntimeFixture() {
  const source = { file: 'Commands/Inspect.vi', target: 'Robot' };
  const projectFile = 'C:\\Test\\Robot.lvproj';
  const commands = decodeLabviewNiInspection({ schemaVersion: 'bordeaux-ni-inspection/1', projectFile, labviewVersion: '25.3.3f3', inspectedAt: '2026-09-07T12:00:00Z', dirtyContext: false,
    vis: [{ ...source, status: 'inspected', name: 'Inspect.vi', description: '', execState: 1, modifiedBefore: false, modifiedAfter: false, dependenciesAvailable: true, dependencies: [],
      defaults: { Sequence: '9223372036854775807', Enabled: true, Mode: 1 },
      connector: { numConnections: 6, captions: ['Info In', 'Info Out', 'Sequence', 'Enabled', 'Mode', 'Result'], wireRequirements: [1, 1, 1, 1, 1, 1], ioStatus: [0, 1, 0, 0, 0, 1], conNum: [8, 0, 11, 9, 10, 12],
        dataTypes: [status('Info In'), status('Info Out'), '<I64><Name>Sequence</Name></I64>', '<Boolean><Name>Enabled</Name></Boolean>', '<EW><Name>Mode</Name><Choice>Idle</Choice><Choice>Active</Choice></EW>', '<U64><Name>Result</Name></U64>'],
        extendedInformation: [metadata('Info In'), metadata('Info Out'), [[]], [[]], [[]], [[]]] } }] }, projectFile, [source]).commands;
  const fixture = binaryWriterFixture(false, false), { project } = fixture;
  const binary = bdxBindingsFromCatalog({ ...fixture.bindings.catalog, commands });
  project.routines = [{ id: 'routine', name: 'Typed runtime routine', nodes: [] }]; project.activeRoutineId = 'routine';
  const invocation = () => ({ commandId: commands[0].id, arguments: {} });
  return { project, command: commands[0], invocation, binary, bindings: routineBindingsFromBinary(binary) };
}
