import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { crc32 as nodeCrc32 } from 'node:zlib';
import { makeZip, crc32, entryNames } from '../pages/zip.js';

// Independent reader: walks the central directory and checks each local entry against it.
function readZip(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const end = buffer.byteLength - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = [];
  for (let i = 0; i < count; i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    assert.equal(view.getUint16(at + 8, true) & 0x0800, 0x0800, 'UTF-8 flag');
    assert.equal(view.getUint16(at + 10, true), 0, 'stored');
    const crc = view.getUint32(at + 16, true), size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true), offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(buffer.subarray(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(offset, true), 0x04034b50);
    assert.equal(view.getUint32(offset + 14, true), crc);
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const data = buffer.subarray(start, start + size);
    assert.equal(nodeCrc32(data), crc, `CRC of ${name}`);
    entries.push({ name, data });
    at += 46 + nameLength;
  }
  return entries;
}
test('crc32 matches zlib, including when computed in slices', () => {
  const bytes = Buffer.from('随心传 PhotoDrop 🏠'.repeat(1000));
  assert.equal(crc32(bytes), nodeCrc32(bytes));
  assert.equal(crc32(bytes.subarray(5000), crc32(bytes.subarray(0, 5000))), nodeCrc32(bytes));
  assert.equal(crc32(new Uint8Array()), 0);
});
test('archive holds every selected file byte-for-byte with Unicode names', async () => {
  const heic = await readFile(new URL('./example.heic', import.meta.url));
  const big = Buffer.alloc(9 * 1024 * 1024 + 17, 201); // Spans several CRC read slices.
  const files = [new File([heic], '原图.heic', { lastModified: Date.UTC(2026, 10, 15, 8, 30) }), new File([big], 'video.mov'), new File([], 'empty.txt')];
  const seen = [];
  const zip = await makeZip(files, p => seen.push(p));
  assert.equal(zip.type, 'application/zip');
  const entries = readZip(Buffer.from(await zip.arrayBuffer()));
  assert.deepEqual(entries.map(e => e.name), ['原图.heic', 'video.mov', 'empty.txt']);
  assert.ok(entries[0].data.equals(heic)); assert.ok(entries[1].data.equals(big)); assert.equal(entries[2].data.length, 0);
  assert.equal(seen.at(-1).loaded, seen.at(-1).total);
});
test('entry names cannot escape the folder and duplicates are kept apart', () => {
  assert.deepEqual(entryNames(['../../evil.sh', 'a/b\\c.jpg', 'IMG_1.JPG', 'img_1.jpg', 'img_1.jpg', '...', 'CON:<>.txt', '']),
    ['_.._evil.sh', 'a_b_c.jpg', 'IMG_1.JPG', 'img_1 (2).jpg', 'img_1 (3).jpg', 'file', 'CON___.txt', 'file (2)']);
});
