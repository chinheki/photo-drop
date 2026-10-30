import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Transfer, validOffer, MAX_BYTES, CHUNK_BYTES } from '../pages/transfer.js';

function pair(t, receiver = {}, sender = {}) {
  let a, b;
  const ca = { open: true, send(data) { queueMicrotask(() => b.receive(structuredClone(data))); } };
  const cb = { open: true, send(data) { queueMicrotask(() => a.receive(structuredClone(data))); } };
  a = new Transfer(ca, sender); b = new Transfer(cb, receiver);
  t.after(() => { a.close(); b.close(); });
  return { a, b, ca, cb };
}
const digest = async file => createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex');
test('HEIC, binary windows, Unicode names and empty files are byte-identical in both directions', async t => {
  const got = [], back = [];
  const { a, b } = pair(t, { offer: () => b.accept(), file: f => got.push(f) }, { offer: () => a.accept(), file: f => back.push(f) });
  const heic = await readFile(new URL('./example.heic', import.meta.url));
  const binary = Buffer.alloc(CHUNK_BYTES * 37 + 183, 173);
  const files = [new File([heic], '原图.heic', { type: 'image/heic', lastModified: 12345 }), new File([binary], 'iPad → 电脑.bin'), new File([], 'empty.txt')];
  await a.send(files);
  assert.equal(got.length, files.length);
  for (let i = 0; i < files.length; i++) {
    assert.equal(await digest(got[i]), await digest(files[i]));
    assert.equal(got[i].name, files[i].name); assert.equal(got[i].type, files[i].type);
    assert.equal(got[i].lastModified, files[i].lastModified);
  }
  await b.send(got);
  assert.equal(back.length, files.length);
  assert.equal(await digest(back[0]), await digest(files[0]));
});
test('no file bytes before consent, rejection resets sender', async t => {
  let sawOffer;
  const offered = new Promise(resolve => { sawOffer = resolve; });
  const { a, b, ca } = pair(t, { offer: sawOffer });
  let binaries = 0;
  const send = ca.send.bind(ca); ca.send = data => { if (data instanceof ArrayBuffer) binaries++; send(data); };
  const sending = a.send([new File(['private bytes'], 'photo.heic')]);
  const rejected = assert.rejects(sending, /拒绝/);
  await offered; assert.equal(binaries, 0); b.reject(); await rejected;
  assert.equal(a.busy, false); assert.equal(b.busy, false);
});
test('receiver cancellation interrupts an in-flight batch and allows retry', async t => {
  let cancelled = false, got = 0;
  const { a, b } = pair(t, { offer: () => b.accept(), progress: p => { if (p.loaded > 0 && !cancelled) { cancelled = true; b.cancel(); } }, file: () => got++ });
  await assert.rejects(a.send([new File([Buffer.alloc(800000)], 'large.bin')]), /取消/);
  assert.equal(got, 0); assert.equal(a.busy, false); assert.equal(b.busy, false);
  await a.send([new File(['retry'], 'retry.txt')]); assert.equal(got, 1);
});
test('disconnect rejects a pending send instead of leaving it stuck', async t => {
  let offered;
  const offer = new Promise(resolve => { offered = resolve; });
  const { a } = pair(t, { offer: offered });
  const sending = a.send([new File(['data'], 'file.txt')]);
  const failed = assert.rejects(sending, /断开/);
  await offer; a.close(); await failed; assert.equal(a.waiters.size, 0);
});
test('oversized, malformed and empty batches cannot reserve receiver memory', () => {
  const file = { name: 'test', size: 1, type: '' };
  assert.equal(validOffer([]), false);
  assert.equal(validOffer(Array(101).fill(file)), false);
  assert.equal(validOffer([{ ...file, size: MAX_BYTES + 1 }]), false);
  assert.equal(validOffer([{ ...file, size: -1 }]), false);
  assert.equal(validOffer([{ ...file, name: '<img onerror=alert(1)>' }]), true); // UI must render names as text.
  assert.equal(validOffer([{ ...file, size: 0 }]), true);
});
test('truncated data is not exposed as a successfully received file', t => {
  let got = 0;
  const { b } = pair(t, { offer: () => b.accept(), file: () => got++ });
  b.receive(JSON.stringify({ type: 'offer', id: 'test', files: [{ name: 'a', type: '', size: 4 }] }));
  b.receive(JSON.stringify({ type: 'file-start', id: 'test', index: 0 }));
  b.receive(new Uint8Array([1, 2]).buffer);
  b.receive(JSON.stringify({ type: 'file-end', id: 'test', index: 0 }));
  assert.equal(got, 0); assert.equal(b.busy, false);
});
