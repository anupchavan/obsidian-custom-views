import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = ['styles.css', 'manifest.json', 'main.js'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Explicit artifact allowlist: saved views/data.json are never copied. */
export async function syncLocal(projectRoot = root) {
    let config;
    try { config = JSON.parse(await readFile(resolve(projectRoot, '.local-deploy.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!Array.isArray(config.targets) || !config.targets.length || config.targets.some(p => typeof p !== 'string' || !p)) {
        throw new Error('Local deployment requires a nonempty targets array.');
    }
    const source = new Map(await Promise.all(artifacts.map(async name => [name, await readFile(resolve(projectRoot, name))])));
    const id = JSON.parse(source.get('manifest.json').toString()).id;
    // Validate every destination before writing anything.
    const targets = await Promise.all(config.targets.map(async target => {
        const path = resolve(projectRoot, target);
        if (path === resolve(projectRoot)) throw new Error('Local deployment target must differ from source.');
        const installed = JSON.parse(await readFile(resolve(path, 'manifest.json'), 'utf8'));
        if (installed.id !== id) throw new Error(`Plugin ID mismatch at ${path}`);
        const changed = [];
        for (const name of artifacts) {
            let previous;
            try { previous = await readFile(resolve(path, name)); }
            catch (error) { if (error.code !== 'ENOENT') throw error; }
            if (!previous?.equals(source.get(name))) changed.push({ name, previous });
        }
        return { path, changed };
    }));
    for (const [index, { path, changed }] of targets.entries()) {
        if (changed.length) {
            const run = `${Date.now()}-${randomUUID()}`;
            const backup = resolve(projectRoot, '.local-deploy-backups', run, String(index));
            await mkdir(backup, { recursive: true });
            for (const { name, previous } of changed) {
                if (previous) await writeFile(resolve(backup, name), previous);
            }
            await writeFile(resolve(backup, 'target.json'), JSON.stringify({ path }));
            // Replace complete files atomically; JS last so hot reload sees current CSS/manifest.
            for (const { name } of changed) {
                const temp = resolve(path, `.cv-sync-${run}-${name}`);
                try {
                    await writeFile(temp, source.get(name));
                    await rename(temp, resolve(path, name));
                } finally { await rm(temp, { force: true }); }
            }
        }
        for (const name of artifacts) {
            if (hash(await readFile(resolve(path, name))) !== hash(source.get(name))) {
                throw new Error(`Local deployment verification failed: ${path}/${name}`);
            }
        }
        console.log(`[local deploy] ${changed.length ? 'Updated' : 'Verified'} ${path} (JS, CSS, manifest)`);
    }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await syncLocal();
