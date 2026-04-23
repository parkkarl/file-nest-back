import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { config } from '../config.ts';

mkdirSync(config.storageDir, { recursive: true });

export type StoredBlob = {
  storagePath: string;
  sizeBytes: number;
  checksum: string;
};

export async function storeBlob(data: ArrayBuffer | Uint8Array): Promise<StoredBlob> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const shard = checksum.slice(0, 2);
  const id = randomUUID();
  const dir = join(config.storageDir, shard);
  mkdirSync(dir, { recursive: true });
  const storagePath = join(shard, `${id}.bin`);
  await Bun.write(join(config.storageDir, storagePath), bytes);
  return { storagePath, sizeBytes: bytes.byteLength, checksum };
}

export function readBlob(storagePath: string): ReadableStream<Uint8Array> {
  const file = Bun.file(join(config.storageDir, storagePath));
  return file.stream();
}

export async function deleteBlob(storagePath: string): Promise<void> {
  try {
    await unlink(join(config.storageDir, storagePath));
  } catch {
    // already gone
  }
}
