// Blob garbage-collection sweep.
// Removes any file in $STORAGE_DIR that is not referenced by a versions.storage_path row.
// Run after a crash (or on a timer) to clean up orphans from failed uploads or interrupted deletes.

import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from './client.ts';
import { versions } from './schema.ts';
import { config } from '../config.ts';

async function listBlobs(): Promise<string[]> {
  const out: string[] = [];
  const shards = await readdir(config.storageDir).catch(() => []);
  for (const shard of shards) {
    const shardPath = join(config.storageDir, shard);
    const s = await stat(shardPath).catch(() => null);
    if (!s?.isDirectory()) continue;
    const files = await readdir(shardPath).catch(() => []);
    for (const f of files) out.push(join(shard, f));
  }
  return out;
}

const referenced = new Set(
  (await db.select({ p: versions.storagePath }).from(versions)).map((r) => r.p),
);

const onDisk = await listBlobs();
let removed = 0;
for (const rel of onDisk) {
  if (referenced.has(rel)) continue;
  await unlink(join(config.storageDir, rel));
  removed++;
}
console.log(`GC: scanned ${onDisk.length} blobs, referenced ${referenced.size}, removed ${removed} orphans.`);
