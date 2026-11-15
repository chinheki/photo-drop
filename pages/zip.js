// Minimal ZIP writer (store, no compression). Photos and videos are already compressed, and
// storing keeps the original bytes. The archive Blob references the received File objects instead
// of copying them; only CRC-32 needs to read each file, in bounded slices.
const READ_BYTES = 4 * 1024 * 1024;
const LIMIT = 0xffffffff;
const encoder = new TextEncoder();
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
// Flatten to a single safe entry name: no directories, no "..", no control or reserved characters.
export function entryNames(names) {
  const used = new Set();
  return names.map(raw => {
    let name = String(raw).replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/^[.\s]+/, '').trim().slice(0, 200) || 'file';
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n})${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}
function dosTime(ms) {
  const d = new Date(Number.isFinite(ms) && ms > 0 ? ms : Date.now());
  if (d.getFullYear() < 1980) return { time: 0, date: (1 << 5) | 1 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.min(d.getFullYear(), 2107) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}
export async function makeZip(files, onProgress) {
  if (files.length >= 0xffff) throw new Error('文件太多，请分批下载。');
  const names = entryNames(files.map(f => f.name));
  const parts = [], central = [];
  const total = files.reduce((n, f) => n + f.size, 0);
  let offset = 0, done = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i], name = encoder.encode(names[i]);
    let crc = 0;
    for (let start = 0; start < file.size; start += READ_BYTES) {
      crc = crc32(new Uint8Array(await file.slice(start, start + READ_BYTES).arrayBuffer()), crc);
      onProgress?.({ index: i, count: files.length, loaded: done + Math.min(start + READ_BYTES, file.size), total });
    }
    done += file.size;
    onProgress?.({ index: i, count: files.length, loaded: done, total });
    const { time, date } = dosTime(file.lastModified);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); local.setUint16(10, time, true); local.setUint16(12, date, true);
    local.setUint32(14, crc, true); local.setUint32(18, file.size, true); local.setUint32(22, file.size, true);
    local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true); entry.setUint16(12, time, true); entry.setUint16(14, date, true);
    entry.setUint32(16, crc, true); entry.setUint32(20, file.size, true); entry.setUint32(24, file.size, true);
    entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true);
    parts.push(local.buffer, name, file); central.push(entry.buffer, name);
    offset += 30 + name.length + file.size;
    if (offset > LIMIT) throw new Error('所选文件太大，请分批下载。');
  }
  const size = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
