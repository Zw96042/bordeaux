import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hasDeploymentReceipt, readDeploymentReceipts, saveDeploymentReceipt, sameDeploymentRevision } from '../src/electron/deploymentReceipts';
import type { RobotRuntimeStatus } from '../src/electron/robotSftpTransport';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });
const receipt = { project: '/project/A.bordeaux.json', runtimeId: 'robot-A', catalogHash: `sha256:${'a'.repeat(64)}`, revisionId: `sha256:${'b'.repeat(64)}`, verifiedAt: new Date().toISOString() };

describe('deployment provenance', () => {
  it('associates only the exact project, runtime, catalog, and accepted revision', () => {
    expect(hasDeploymentReceipt([receipt], receipt)).toBe(true);
    for (const key of ['project', 'runtimeId', 'catalogHash', 'revisionId'] as const) expect(hasDeploymentReceipt([receipt], { ...receipt, [key]: 'different' })).toBe(false);
    expect(hasDeploymentReceipt([], receipt)).toBe(false);
  });
  it('persists and deduplicates receipts while rejecting corrupt history', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bordeaux-receipts-')); directories.push(dir);
    const file = path.join(dir, 'receipts.json');
    expect(await readDeploymentReceipts(file)).toEqual([]);
    await saveDeploymentReceipt(file, receipt); await saveDeploymentReceipt(file, receipt);
    expect(await readDeploymentReceipts(file)).toEqual([receipt]);
    await fs.writeFile(file, '[{"revisionId":"fake"}]');
    await expect(readDeploymentReceipts(file)).rejects.toThrow('invalid');
  });
  it('rejects stale comparison evidence when runtime revision or shared context changes', () => {
    const status: RobotRuntimeStatus = { protocolVersion: 'bordeaux-robot-push/1.0', deploymentNamespace: '/home/lvuser/deploy/bordeaux/push-v1', teamNumber: 1, runtimeId: 'runtime', disabled: true, catalogId: 'catalog', catalogHash: receipt.catalogHash, supportVersion: '1', fieldId: 'field', fieldRevision: '1', fieldCoordinateSchemaId: '1', activeRevisionId: receipt.revisionId, activePayloadSha256: receipt.catalogHash, health: [] };
    expect(sameDeploymentRevision(status, { ...status })).toBe(true);
    expect(sameDeploymentRevision(status, { ...status, activeRevisionId: null, activePayloadSha256: null })).toBe(false);
    expect(sameDeploymentRevision(status, { ...status, fieldRevision: '2' })).toBe(false);
    expect(sameDeploymentRevision(status, { ...status, runtimeId: 'repaired' })).toBe(false);
  });
});
