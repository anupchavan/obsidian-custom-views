import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncLocal } from './sync-local.mjs';

async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'cv-deploy-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const target = join(root, 'installed'); await mkdir(target);
    for (const dir of [root, target]) {
        await writeFile(join(dir, 'manifest.json'), JSON.stringify({ id: 'custom-views' }));
        await writeFile(join(dir, 'main.js'), dir === root ? 'new JS' : 'old JS');
        await writeFile(join(dir, 'styles.css'), dir === root ? 'new CSS' : 'old CSS');
    }
    await writeFile(join(root, '.local-deploy.json'), JSON.stringify({ targets: [target] }));
    return { root, target };
}

test('copies only allowed artifacts, backs up previous files, and skips unchanged installs', async t => {
    const { root, target } = await fixture(t);
    await writeFile(join(root, 'data.json'), 'source settings');
    await writeFile(join(target, 'data.json'), 'personal settings');
    await syncLocal(root);
    assert.equal(await readFile(join(target, 'main.js'), 'utf8'), 'new JS');
    assert.equal(await readFile(join(target, 'styles.css'), 'utf8'), 'new CSS');
    assert.equal(await readFile(join(target, 'data.json'), 'utf8'), 'personal settings');
    const runs = await readdir(join(root, '.local-deploy-backups'));
    assert.equal(await readFile(join(root, '.local-deploy-backups', runs[0], '0', 'main.js'), 'utf8'), 'old JS');
    await syncLocal(root);
    assert.deepEqual(await readdir(join(root, '.local-deploy-backups')), runs);
});

test('rejects mismatched plugins without changing destination files', async t => {
    const { root, target } = await fixture(t);
    await writeFile(join(target, 'manifest.json'), JSON.stringify({ id: 'other-plugin' }));
    await assert.rejects(syncLocal(root), /Plugin ID mismatch/);
    assert.equal(await readFile(join(target, 'main.js'), 'utf8'), 'old JS');
});

test('is opt-in and refuses missing build artifacts before writing', async t => {
    const { root, target } = await fixture(t);
    await rm(join(root, 'main.js'));
    await assert.rejects(syncLocal(root), /ENOENT/);
    assert.equal(await readFile(join(target, 'styles.css'), 'utf8'), 'old CSS');
    await rm(join(root, '.local-deploy.json'));
    await syncLocal(root);
});
