// Reliable, bounded, consent-first transfer over an ordered WebRTC data channel.
export const MAX_BYTES = 200 * 1024 * 1024;
export const CHUNK_BYTES = 16 * 1024;
const WINDOW_BYTES = 256 * 1024;
export function validOffer(files) {
  return Array.isArray(files) && files.length > 0 && files.length <= 100 &&
    files.every(f => f && typeof f.name === 'string' && f.name.length > 0 && f.name.length <= 512 &&
      Number.isSafeInteger(f.size) && f.size >= 0 && typeof f.type === 'string' && f.type.length <= 255) &&
    files.reduce((n, f) => n + f.size, 0) <= MAX_BYTES;
}
export class Transfer {
  constructor(connection, handlers = {}) {
    this.connection = connection;
    this.handlers = handlers;
    this.outgoing = null;
    this.incoming = null;
    this.waiters = new Map();
    this.closed = false;
  }
  get busy() { return !!(this.outgoing || this.incoming); }
  control(message) {
    if (this.closed || !this.connection.open) throw new Error('连接已断开，请重新连接。');
    this.connection.send(JSON.stringify(message));
  }
  wait(key, timeout = 45000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(key); reject(new Error('等待对方超时，请保持两边网页在前台后重试。')); }, timeout);
      this.waiters.set(key, { resolve, reject, timer });
    });
  }
  resolve(key, value) {
    const w = this.waiters.get(key);
    if (!w) return;
    clearTimeout(w.timer); this.waiters.delete(key); w.resolve(value);
  }
  rejectWaiters(error) {
    for (const w of this.waiters.values()) { clearTimeout(w.timer); w.reject(error); }
    this.waiters.clear();
  }
  touch() {
    clearTimeout(this.incomingTimer);
    this.incomingTimer = setTimeout(() => this.cancel('接收超时，请保持两边网页在前台后重试。'), 90000);
  }
  async send(files) {
    if (this.busy) throw new Error('请等待当前传输完成。');
    const metadata = files.map(f => ({ name: f.name, size: f.size, type: f.type || '', lastModified: f.lastModified || 0 }));
    if (!validOffer(metadata)) throw new Error('每批最多 100 个文件，合计不能超过 200 MB。请分批发送。');
    const id = crypto.randomUUID();
    const state = { id, files, cancelled: false };
    this.outgoing = state;
    const total = files.reduce((n, f) => n + f.size, 0);
    try {
      const consent = this.wait(`${id}:accept`, 120000);
      this.control({ type: 'offer', id, files: metadata });
      this.handlers.progress?.({ direction: 'send', text: '等待对方点击“接收”…', loaded: 0, total });
      await consent;
      let completed = 0;
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        if (state.cancelled) throw new Error('传输已取消。');
        this.control({ type: 'file-start', id, index });
        for (let start = 0; start < file.size; start += WINDOW_BYTES) {
          const end = Math.min(start + WINDOW_BYTES, file.size);
          // Read only a bounded window, so sending a large file does not duplicate it in memory.
          const bytes = await file.slice(start, end).arrayBuffer();
          if (state.cancelled) throw new Error('传输已取消。');
          const ack = this.wait(`${id}:ack:${index}:${end}`);
          for (let offset = 0; offset < bytes.byteLength; offset += CHUNK_BYTES) {
            this.connection.send(bytes.slice(offset, offset + CHUNK_BYTES));
          }
          await ack;
          this.handlers.progress?.({ direction: 'send', text: `正在发送 ${index + 1}/${files.length}：${file.name}`, loaded: completed + end, total });
        }
        const saved = this.wait(`${id}:file-done:${index}`);
        this.control({ type: 'file-end', id, index });
        await saved;
        completed += file.size;
      }
      this.outgoing = null;
      this.handlers.complete?.('send');
    } catch (error) {
      if (this.outgoing === state) this.cancel(error.message);
      throw error;
    } finally {
      if (this.outgoing === state) this.outgoing = null;
    }
  }
  accept() {
    const state = this.incoming;
    if (!state || state.accepted) return;
    state.accepted = true;
    this.touch();
    this.control({ type: 'accept', id: state.id });
    this.handlers.progress?.({ direction: 'receive', text: '准备接收…', loaded: 0, total: state.total });
  }
  reject(reason = '对方拒绝了本次传输。') {
    if (!this.incoming) return;
    this.control({ type: 'reject', id: this.incoming.id, reason });
    this.incoming = null;
    clearTimeout(this.incomingTimer);
    this.handlers.cancelled?.('已拒绝接收。');
  }
  cancel(reason = '传输已取消。', notify = true) {
    const id = this.outgoing?.id || this.incoming?.id;
    if (notify && id && this.connection.open && !this.closed) this.control({ type: 'cancel', id, reason });
    if (this.outgoing) this.outgoing.cancelled = true;
    this.outgoing = null; this.incoming = null;
    clearTimeout(this.incomingTimer);
    this.rejectWaiters(new Error(reason));
    this.handlers.cancelled?.(reason);
  }
  close() { this.closed = true; this.cancel('连接已断开，未完成的文件需要重新发送。', false); }
  receive(data) {
    try {
      if (data instanceof ArrayBuffer) { this.chunk(data); return; }
      if (typeof data !== 'string' || data.length > 128 * 1024) return;
      const m = JSON.parse(data);
      if (!m || typeof m.id !== 'string' || m.id.length > 64) return;
      if (m.type === 'offer') {
        if (this.busy || !validOffer(m.files)) {
          this.control({ type: 'reject', id: m.id, reason: '对方正在传输，或文件超过每批 200 MB / 100 个的限制。' }); return;
        }
        this.incoming = { id: m.id, files: m.files, index: 0, accepted: false, parts: [], loaded: 0, completed: 0, total: m.files.reduce((n, f) => n + f.size, 0), current: false };
        this.touch();
        this.handlers.offer?.(m.files);
      } else if (m.id === this.outgoing?.id) {
        if (m.type === 'accept') this.resolve(`${m.id}:accept`);
        if (m.type === 'ack') this.resolve(`${m.id}:ack:${m.index}:${m.loaded}`);
        if (m.type === 'file-done') this.resolve(`${m.id}:file-done:${m.index}`);
        if (m.type === 'reject' || m.type === 'cancel') this.cancel(typeof m.reason === 'string' ? m.reason.slice(0,300) : '对方取消了传输。', false);
      } else if (m.id === this.incoming?.id) {
        const s = this.incoming;
        if (m.type === 'cancel') { this.cancel('对方取消了传输。', false); return; }
        if (!s.accepted || m.index !== s.index) return;
        this.touch();
        if (m.type === 'file-start' && !s.current) { s.current = true; s.parts = []; s.loaded = 0; }
        if (m.type === 'file-end' && s.current) {
          const meta = s.files[s.index];
          if (s.loaded !== meta.size) throw new Error('文件不完整，请重新发送。');
          const file = new File(s.parts, meta.name, { type: meta.type, lastModified: Number.isFinite(meta.lastModified) ? meta.lastModified : Date.now() });
          this.handlers.file?.(file);
          this.control({ type: 'file-done', id: s.id, index: s.index });
          s.completed += meta.size; s.index++; s.parts = []; s.current = false;
          if (s.index === s.files.length) { this.incoming = null; clearTimeout(this.incomingTimer); this.handlers.complete?.('receive'); }
        }
      }
    } catch (error) { this.cancel(error.message || '传输格式错误，请重新连接。'); }
  }
  chunk(bytes) {
    const s = this.incoming;
    if (!s?.accepted || !s.current) return;
    const meta = s.files[s.index];
    if (!bytes.byteLength || bytes.byteLength > CHUNK_BYTES || s.loaded + bytes.byteLength > meta.size) throw new Error('接收的数据大小异常，已停止传输。');
    s.parts.push(bytes); s.loaded += bytes.byteLength; this.touch();
    if (s.loaded % WINDOW_BYTES === 0 || s.loaded === meta.size) {
      this.control({ type: 'ack', id: s.id, index: s.index, loaded: s.loaded });
      this.handlers.progress?.({ direction: 'receive', text: `正在接收 ${s.index + 1}/${s.files.length}：${meta.name}`, loaded: s.completed + s.loaded, total: s.total });
    }
  }
}
