import { Transfer, MAX_BYTES, MAX_TEXT_BYTES } from './transfer.js';
const $ = id => document.getElementById(id);
const VERSION = '2.1.0';
const PREFIX = 'chinheki-photodrop-v2-';
let peer, connection, transfer, generation = 0, timer, wakeLock, code = '', joining = false;
// peerText: undefined until the peer's hello arrives; false means its page predates text support.
let textSending = false, peerText;
const utf8 = new TextEncoder();
let received = [];
let receivedBytes = 0;
const device = /iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) ? 'iPad' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android 手机' : /Windows/.test(navigator.userAgent) ? 'Windows 电脑' : /Mac/.test(navigator.userAgent) ? 'Mac 电脑' : '浏览器设备';
$('device-name').textContent = `本机：${device}`;
function size(bytes) { return bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`; }
function randomCode() {
  const n = new Uint32Array(1);
  do { crypto.getRandomValues(n); } while (n[0] >= 4294000000);
  return String(n[0] % 1000000).padStart(6, '0');
}
function notice(message, error = false) { $('notice').textContent = message; $('notice').dataset.error = String(error); }
function buttons() {
  const disabled = !connection?.open || !!transfer?.busy;
  $('choose-photos').disabled = disabled; $('choose-files').disabled = disabled;
  // Text is not blocked by a running file batch.
  $('send-text').disabled = !connection?.open || textSending || !$('text-input').value.trim() || textOver();
}
function textOver() { return utf8.encode($('text-input').value).byteLength > MAX_TEXT_BYTES; }
function textStatus(message, error = false) { $('text-status').textContent = message; $('text-status').dataset.error = String(error); }
function updateTextCount() {
  const value = $('text-input').value, over = textOver();
  $('text-count').textContent = over ? '超出长度上限，请分段发送或存成文件' : value ? `${Array.from(value).length} 字` : '';
  $('text-count').dataset.over = String(over);
  buttons();
}
async function keepAwake() {
  try { if (!wakeLock && document.visibilityState === 'visible' && transfer?.busy) wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* Unsupported or system denied: foreground guidance remains visible. */ }
}
function releaseWake() { wakeLock?.release().catch(() => {}); wakeLock = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { wakeLock = null; keepAwake(); } });
function finish(message, error = false) {
  $('incoming').hidden = true; $('transfer').hidden = true;
  releaseWake(); notice(message, error); buttons();
}
function resetConnection() {
  generation++; clearTimeout(timer);
  transfer?.close(); transfer = null;
  connection?.close(); connection = null;
  peer?.destroy(); peer = null; joining = false; peerText = undefined;
  releaseWake(); buttons();
}
function leave() {
  resetConnection();
  $('pair-controls').hidden = false; $('room-panel').hidden = true;
  $('connection-badge').textContent = '未连接';
  $('pair-status').textContent = '已退出。可以使用另一组数字重新连接。';
  $('connect').disabled = false; $('connect-qr').disabled = false;
  $('send-help').textContent = '连接成功后，两边都可以发送和接收。';
  notice(''); textStatus('');
  history.replaceState(null, '', location.pathname + location.search);
}
function failure(message) {
  resetConnection();
  $('pair-controls').hidden = false; $('room-panel').hidden = true;
  $('connect').disabled = false; $('connect-qr').disabled = false; $('connection-badge').textContent = '连接失败';
  $('send-help').textContent = '连接成功后，两边都可以发送和接收。';
  $('pair-status').textContent = message;
}
function showRoom(status) {
  $('pair-controls').hidden = true; $('room-panel').hidden = false;
  $('active-code').textContent = `${code.slice(0,3)} ${code.slice(3)}`;
  $('connection-status').textContent = status;
  $('pair-status').textContent = '请保持两边网页在前台。连接成功后可双向互传。';
  const url = new URL(location.href); url.hash = `room=${code}`; url.search = '';
  // QR content contains only our URL and a validated six-digit room code.
  $('qr').innerHTML = new window.QRCode({ content: url.href, padding: 4, width: 172, height: 172, ecl: 'M', color: '#172e55', background: '#ffffff', container: 'svg-viewbox' }).svg();
  history.replaceState(null, '', url);
}
function bindConnection(conn, epoch) {
  if (generation !== epoch) { conn.close(); return; }
  if (connection && connection !== conn) {
    conn.on('open', () => { conn.send(JSON.stringify({ type: 'room-full' })); setTimeout(() => conn.close(), 300); });
    return;
  }
  connection = conn;
  clearTimeout(timer);
  timer = setTimeout(() => { if (generation === epoch) failure('设备直连超时。请连接同一 Wi-Fi，关闭 VPN，或换到同一手机热点后重试。'); }, 35000);
  conn.on('open', () => {
    if (generation !== epoch) return;
    clearTimeout(timer);
    transfer = new Transfer(conn, {
      offer(files) {
        const bytes = files.reduce((n,f) => n + f.size, 0);
        if (receivedBytes + bytes > MAX_BYTES) { transfer.reject('对方的接收列表空间不足，请先保存并清空列表后重试。'); return; }
        $('incoming-summary').textContent = `${files.length} 个文件，共 ${size(bytes)}。${files.slice(0,3).map(f => f.name).join('、')}${files.length > 3 ? '…' : ''}`;
        $('incoming').hidden = false; buttons(); notice('请确认这是你要接收的文件。'); keepAwake();
      },
      progress({ direction, text, loaded, total }) {
        $('incoming').hidden = true; $('transfer').hidden = false;
        $('transfer-title').textContent = direction === 'send' ? '发送中' : '接收中';
        $('progress').value = total ? loaded / total * 100 : 0;
        $('transfer-status').textContent = `${text} · ${size(loaded)} / ${size(total)}`;
        buttons(); keepAwake();
      },
      file: addReceived,
      text(value) { addText(value); notice('收到一段文字，可在下方“收到的内容”复制。'); },
      complete(direction) { finish(direction === 'send' ? '发送完成，对方已收到全部文件。' : '接收完成。请在下方保存文件。'); },
      cancelled(reason) { finish(reason, true); }
    });
    // features stays additive so 2.0.x pages still connect and exchange files.
    conn.send(JSON.stringify({ type: 'hello', device, version: 2, features: ['text'] }));
    $('connection-badge').textContent = '已连接';
    $('connection-status').textContent = '已连接另一台设备，可以双向互传。';
    $('send-help').textContent = '已连接。你可以发送，也可以等待对方发来文件或文字。';
    notice('文件发送前，对方会看到接收确认；文字会直接显示给对方。'); textStatus(''); buttons();
  });
  conn.on('data', data => {
    if (generation !== epoch) return;
    if (typeof data === 'string' && data.length < 1024) {
      try {
        const m = JSON.parse(data);
        if (m.type === 'room-full') { failure('这组数字已有两台设备，请换一组数字连接。'); return; }
        if (m.type === 'hello') {
          if (m.version !== 2) { failure('两边网页版本不同，请检查更新后重新连接。'); return; }
          $('connection-status').textContent = `已连接：${String(m.device).slice(0,40)}。可以互相发送。`;
          peerText = Array.isArray(m.features) && m.features.includes('text');
          if (!peerText) textStatus('对方网页版本较旧，不能接收文字。请对方点页面底部“检查更新”，刷新后重新连接。', true);
          return;
        }
      } catch { /* Transfer validates other messages. */ }
    }
    transfer?.receive(data);
  });
  conn.on('close', () => { if (generation === epoch) failure('对方已离开或网络中断。已收到的文件仍在下方，请重新连接后发送未完成的文件。'); });
  conn.on('error', () => { if (generation === epoch) failure('传输连接中断，请检查网络后重新连接。'); });
}
function createPeer(asGuest, epoch) {
  // Signal server exchanges connection metadata only. No TURN relay is configured.
  const options = { debug: 0, secure: true, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] } };
  const p = asGuest ? new window.Peer(options) : new window.Peer(PREFIX + code, options);
  peer = p;
  p.on('open', () => {
    if (generation !== epoch || peer !== p) { p.destroy(); return; }
    clearTimeout(timer); joining = false;
    $('connection-badge').textContent = asGuest ? '正在连接' : '等待另一台';
    showRoom(asGuest ? '正在连接使用相同数字的设备…' : '准备好了，另一台扫码或输入相同数字即可连接。');
    if (asGuest) bindConnection(p.connect(PREFIX + code, { reliable: true, serialization: 'raw' }), epoch);
  });
  p.on('connection', conn => bindConnection(conn, epoch));
  p.on('error', error => {
    if (generation !== epoch || peer !== p) return;
    if (error.type === 'unavailable-id' && !asGuest) {
      // destroy() synchronously emits disconnected; detach the old peer first.
      peer = null; p.destroy(); createPeer(true, epoch); return;
    }
    if (connection?.open && ['network','socket-error','disconnected'].includes(error.type)) {
      $('pair-status').textContent = '配对服务暂时断开，当前设备间连接仍可使用。'; return;
    }
    failure(error.type === 'peer-unavailable' ? '另一台设备刚刚退出了。请两边重新点击连接。' : '连接服务暂时不可达。请确认可以联网，然后重试。');
  });
  p.on('disconnected', () => {
    if (generation !== epoch || peer !== p) return;
    if (connection?.open) $('pair-status').textContent = '配对服务暂时断开，当前设备间连接仍可使用。';
    else failure('配对服务已断开，请重新点击连接。');
  });
}
function connect() {
  if (joining) return;
  const value = $('room-code').value.trim();
  if (!/^\d{6}$/.test(value)) {
    $('code-error').textContent = '请输入完整的六位数字。'; $('room-code').setAttribute('aria-invalid', 'true'); $('room-code').focus(); return;
  }
  $('code-error').textContent = ''; $('room-code').removeAttribute('aria-invalid'); $('room-code').blur();
  if (!window.Peer || !window.RTCPeerConnection) { failure('当前浏览器无法使用设备直传，请用新版 Safari、Chrome 或 Edge 打开。'); return; }
  resetConnection(); code = value; joining = true;
  $('connect').disabled = true; $('connect-qr').disabled = true; $('pair-status').textContent = '正在连接服务…';
  const epoch = generation;
  timer = setTimeout(() => { if (generation === epoch) failure('连接服务超时，请检查互联网连接后重试。'); }, 25000);
  createPeer(false, epoch);
}
function addReceived(file) {
  const url = URL.createObjectURL(file); received.push({ file, url }); receivedBytes += file.size;
  const row = document.createElement('div'); row.className = 'file-row';
  // Do not render active formats (SVG/HTML) or auto-open downloads from peers.
  if (/^image\/(jpeg|png|gif|webp|avif)$/.test(file.type)) {
    const image = document.createElement('img'); image.className = 'file-preview'; image.alt = ''; image.src = url; image.onerror = () => image.remove(); row.append(image);
  }
  const info = document.createElement('div'); info.className = 'file-info';
  const name = document.createElement('strong'); name.textContent = file.name;
  const meta = document.createElement('p'); meta.textContent = `${size(file.size)} · 原文件`;
  info.append(name, meta); row.append(info);
  const actions = document.createElement('div'); actions.className = 'file-actions';
  const download = document.createElement('a'); download.href = url; download.download = file.name; download.textContent = '下载'; actions.append(download);
  if (navigator.canShare?.({ files: [file] })) {
    const share = document.createElement('button'); share.className = 'secondary'; share.textContent = '分享 / 存储';
    share.onclick = async () => { try { await navigator.share({ files: [file] }); } catch (e) { if (e.name !== 'AbortError') notice('系统暂不支持分享这个文件，请点击“下载”存储。', true); } };
    actions.append(share);
  }
  row.append(actions); $('received').append(row); $('received-section').hidden = false;
}
function addText(text) {
  received.push({ text });
  const row = document.createElement('div'); row.className = 'file-row text-row';
  const icon = document.createElement('span'); icon.className = 'text-icon'; icon.setAttribute('aria-hidden', 'true'); icon.textContent = '文';
  const info = document.createElement('div'); info.className = 'file-info';
  const title = document.createElement('strong'); title.textContent = '文字';
  // Peer text is rendered with textContent only; never as HTML.
  const body = document.createElement('div'); body.className = 'text-body'; body.textContent = text;
  const time = new Date();
  const meta = document.createElement('p'); meta.textContent = `${Array.from(text).length} 字 · ${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')} 收到`;
  info.append(title, body, meta); row.append(icon, info);
  const actions = document.createElement('div'); actions.className = 'file-actions';
  const copy = document.createElement('button'); copy.className = 'secondary'; copy.textContent = '复制';
  copy.onclick = async () => {
    if (await copyText(text)) { copy.textContent = '已复制'; setTimeout(() => { copy.textContent = '复制'; }, 2000); }
    else notice('浏览器不允许自动复制，请长按或选中文字后手动复制。', true);
  };
  actions.append(copy);
  const link = singleLink(text);
  if (link) {
    const open = document.createElement('a'); open.href = link; open.target = '_blank'; open.rel = 'noopener noreferrer'; open.textContent = '打开链接';
    actions.append(open);
  }
  row.append(actions); $('received').append(row); $('received-section').hidden = false;
}
// Only a message that is exactly one http(s) URL gets an "open" link; nothing is opened automatically.
function singleLink(text) {
  const value = text.trim();
  if (!/^https?:\/\/\S+$/i.test(value)) return null;
  try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* Fall back for browsers without async clipboard permission. */ }
  const area = document.createElement('textarea');
  area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.append(area); area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove(); return ok;
}
async function sendText() {
  const value = $('text-input').value;
  if (!value.trim() || textSending) return;
  if (!transfer || !connection?.open) { textStatus('请先连接另一台设备。', true); return; }
  if (peerText === false) { textStatus('对方网页版本较旧，不能接收文字。请对方点页面底部“检查更新”，刷新后重新连接。', true); return; }
  const epoch = generation;
  textSending = true; textStatus('发送中…'); buttons();
  try {
    await transfer.sendText(value);
    if (generation !== epoch) return;
    // Keep anything typed while waiting for the acknowledgement.
    if ($('text-input').value === value) $('text-input').value = '';
    textStatus('文字已送达对方。');
  } catch (error) {
    if (generation === epoch) textStatus(error.message, true);
  } finally {
    textSending = false; updateTextCount();
  }
}
async function sendFiles(event) {
  const files = Array.from(event.target.files || []); event.target.value = '';
  if (!files.length) return;
  if (!transfer || !connection?.open) { notice('请先连接另一台设备。', true); return; }
  notice('');
  try { await transfer.send(files); } catch (error) { finish(error.message, true); }
}
$('connect').onclick = connect;
$('connect-qr').onclick = () => {
  if (joining) return;
  $('room-code').value = randomCode();
  connect();
};
$('random-code').onclick = () => { $('room-code').value = randomCode(); $('code-error').textContent = ''; $('room-code').removeAttribute('aria-invalid'); };
$('room-code').addEventListener('input', event => { if (!event.isComposing) $('room-code').value = $('room-code').value.replace(/[^0-9]/g, '').slice(0,6); });
$('room-code').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); event.target.blur(); } });
$('leave').onclick = () => { if (transfer?.busy && !confirm('退出将中断当前传输，确定退出吗？')) return; leave(); };
$('copy-link').onclick = async () => { try { await navigator.clipboard.writeText(location.href); $('pair-status').textContent = '连接链接已复制，发给另一台设备打开即可。'; } catch { $('pair-status').textContent = '请复制浏览器地址栏中的链接，或让对方扫码。'; } };
$('choose-photos').onclick = () => $('photos').click();
$('choose-files').onclick = () => $('files').click();
$('photos').onchange = sendFiles; $('files').onchange = sendFiles;
$('accept').onclick = () => { transfer?.accept(); buttons(); };
$('reject').onclick = () => { transfer?.reject(); buttons(); };
$('cancel-transfer').onclick = () => transfer?.cancel();
$('send-text').onclick = sendText;
$('text-input').addEventListener('input', updateTextCount);
$('text-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); sendText(); }
});
$('clear-received').onclick = () => {
  if (!confirm('请先保存需要的文件和文字。清空后无法从网页恢复，确定清空吗？')) return;
  for (const item of received) if (item.url) URL.revokeObjectURL(item.url);
  received = []; receivedBytes = 0; $('received').replaceChildren(); $('received-section').hidden = true;
};
$('check-update').onclick = async () => {
  $('check-update').disabled = true; $('update-status').textContent = '正在检查更新…';
  try {
    const response = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const current = await response.json();
    if (current.version === VERSION) $('update-status').textContent = `当前已是最新版本 ${VERSION}`;
    else if (transfer?.busy || received.length) $('update-status').textContent = `有新版本 ${current.version}。请先完成传输并保存收到的文件，再刷新网页。`;
    else { $('update-status').textContent = `有新版本 ${current.version}。`; if (confirm('发现新版本，是否刷新网页更新？当前连接会断开。')) location.reload(); }
  } catch { $('update-status').textContent = '检查失败，请确认联网后重试。'; }
  finally { $('check-update').disabled = false; }
};
window.addEventListener('beforeunload', event => { if (transfer?.busy || received.length) { event.preventDefault(); event.returnValue = ''; } });
window.addEventListener('pagehide', () => { resetConnection(); });
const initial = new URLSearchParams(location.hash.slice(1)).get('room');
$('room-code').value = /^\d{6}$/.test(initial || '') ? initial : randomCode();
if (/^\d{6}$/.test(initial || '')) connect();
