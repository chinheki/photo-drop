window.addEventListener('DOMContentLoaded', () => {
    const target = document.getElementById('send-target');
    const status = document.getElementById('send-status');
    const requested = new URLSearchParams(location.search).get('receiver');
    const names = new Map();
    const connected = new Set();
    const buttons = ['choose-photos', 'choose-files', 'send-text-button'].map(id => document.getElementById(id));
    let sending = false;
    let items = [];
    const queue = document.getElementById('photo-queue');
    function state(item, value, text) {
        item.row.dataset.state = value;
        item.label.textContent = text;
        item.ring.setAttribute('aria-label', text);
        item.ring.textContent = value === 'done' ? '✓' : value === 'error' ? '!' : value === 'ready' ? '✓' : '';
    }
    function createQueue(files) {
        for (const item of items) if (item.url) URL.revokeObjectURL(item.url);
        queue.replaceChildren();
        items = files.map(file => {
            const row = document.createElement('div'); row.className = 'photo-item';
            const img = document.createElement('img'); img.alt = file.name; img.loading = 'lazy';
            const info = document.createElement('div');
            const name = document.createElement('strong'); name.textContent = file.name;
            const label = document.createElement('span');
            const ring = document.createElement('div'); ring.className = 'photo-ring'; ring.setAttribute('role','img');
            info.append(name,label); row.append(img,info,ring); queue.append(row);
            const url = URL.createObjectURL(file); img.src = url;
            img.onerror = () => {img.style.visibility = 'hidden';};
            const item = {row,img,label,ring,url}; state(item,'queued','排队中'); return item;
        });
    }
    window.addEventListener('photo-item', event => {
        const {index,state: value,file,error} = event.detail;
        const item = items[index]; if (!item) return;
        state(item,value,value === 'processing' ? '正在处理…' : value === 'ready' ? '处理完成，等待电脑确认' : error);
        if (file) {
            item.file = file;
            URL.revokeObjectURL(item.url); item.url = URL.createObjectURL(file);
            item.img.style.visibility = ''; item.img.src = item.url;
        }
    });
    window.addEventListener('photo-batch-ready', () => {if (sending) status.textContent = '图片处理完成，等待电脑确认接收。请在电脑点击“接收”。';});
    window.addEventListener('photo-batch-error', event => {
        for (const item of items) if (item.row.dataset.state !== 'error') state(item,'error','本批未发送，请重新选择');
        setSending(false); status.textContent = `未发送：${event.detail}`;
    });
    window.addEventListener('photo-file-start', event => {
        const item = items.find(item => item.file === event.detail.file);
        if (item) state(item,'sending','正在发送…');
    });
    window.addEventListener('photo-file-done', event => {
        const item = items.find(item => item.file === event.detail.file);
        if (item) state(item,'done','已发送');
    });
    function refresh() {
        const previous = target.value;
        target.replaceChildren(new Option(connected.size ? '请选择接收设备' : '等待电脑连接，请保持电脑网页打开…', ''));
        for (const id of connected) target.add(new Option(names.get(id) || '接收设备', id));
        if (connected.has(previous)) target.value = previous;
        else if (requested && connected.has(requested)) target.value = requested;
        else if (!requested && connected.size === 1) target.value = [...connected][0];
        for (const button of buttons) button.disabled = !target.value || sending;
        status.textContent = target.value ? `已连接：${names.get(target.value) || '接收设备'}，请选择发送内容` : '等待接收设备，请保持电脑网页打开';
    }
    window.addEventListener('peers', event => {
        for (const peer of event.detail.peers) names.set(peer.id, peer.name?.displayName || peer.name?.deviceName || '接收设备');
    });
    window.addEventListener('peer-joined', event => {
        const peer = event.detail.peer;
        names.set(peer.id, peer.name?.displayName || '接收设备');
    });
    window.addEventListener('peer-connected', event => { connected.add(event.detail.peerId); refresh(); });
    window.addEventListener('peer-disconnected', event => { connected.delete(event.detail); setSending(false); refresh(); });
    window.addEventListener('peer-display-name-changed', event => {
        names.set(event.detail.peerId, event.detail.displayName); refresh();
    });
    target.addEventListener('change', refresh);
    document.querySelectorAll('[data-send-mode]').forEach(button => button.addEventListener('click', () => {
        document.querySelectorAll('[data-send-mode]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
        for (const kind of ['photo', 'text', 'file']) document.getElementById(`send-${kind}-pane`).hidden = kind !== button.dataset.sendMode;
    }));
    const setSending = value => { sending = value; for (const button of buttons) button.disabled = !target.value || value; };
    for (const kind of ['photos', 'files']) {
        const input = document.getElementById(`send-${kind}`);
        document.getElementById(`choose-${kind}`).addEventListener('click', () => { if (target.value) input.click(); });
        input.addEventListener('change', () => {
            if (!input.files.length || !target.value) return;
            setSending(true);
            if (kind === 'photos') createQueue([...input.files]);
            else {queue.replaceChildren(); for(const item of items) URL.revokeObjectURL(item.url); items = [];}
            status.textContent = kind === 'photos' ? '正在处理图片，请稍候…' : '等待电脑确认接收文件…';
            window.dispatchEvent(new CustomEvent('files-selected', {detail: {files: [...input.files], to: target.value, kind: kind === 'files' ? 'file' : 'photo'}}));
            input.value = '';
        });
    }
    document.getElementById('send-text-button').addEventListener('click', () => {
        const text = document.getElementById('send-text-value').value;
        if (!target.value || !text.trim()) {status.textContent = '请先输入文字'; return;}
        window.dispatchEvent(new CustomEvent('send-text', {detail: {text, to: target.value}}));
        status.textContent = '文字已发送';
    });
    window.addEventListener('set-progress', event => {
        if (sending && event.detail.status === 'wait' && event.detail.progress === 0) status.textContent = '等待电脑确认接收，请在电脑端点击“接收”。';
        if (sending && event.detail.status === 'transfer') status.textContent = `正在发送 ${Math.round(event.detail.progress * 100)}%`;
    });
    window.addEventListener('files-sent', () => {setSending(false); status.textContent = '发送完成，可以继续发送';});
    window.addEventListener('notify-user', event => {
        const message = String(event.detail);
        if (/未发送|拒绝|取消|declin|reject/i.test(message)) {setSending(false); status.textContent = message; for(const item of items) if(item.row.dataset.state !== 'done') state(item,'error',message);}
    });
    window.addEventListener('ws-disconnected', () => {connected.clear(); setSending(false); refresh();});
});
