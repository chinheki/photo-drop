window.addEventListener('DOMContentLoaded', () => {
    let selfId = '';
    window.addEventListener('display-name', event => { selfId = event.detail.peerId; });
    const dialog = document.getElementById('phone-dialog');
    const address = document.getElementById('phone-address');
    const qr = document.getElementById('phone-qr');
    const help = document.getElementById('phone-help');
    async function render() {
        qr.replaceChildren();
        if (!address.value) return;
        if (!window.QRCode) await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'scripts/libs/qr-code.min.js';
            script.onload = resolve;
            script.onerror = () => reject(new Error('二维码加载失败，请重新打开'));
            document.head.append(script);
        });
        const code = new QRCode({content: address.value, width: 224, height: 224,
            padding: 4, background: 'white', color: '#172554', ecl: 'M', join: true});
        qr.innerHTML = code.svg();
        help.textContent = '扫码后打不开？确认连接同一 Wi-Fi，并允许电脑防火墙放行 19091 端口。';
    }
    document.getElementById('phone-open').addEventListener('click', async () => {
        dialog.showModal();
        help.textContent = '正在获取局域网地址…';
        try {
            const response = await fetch('/phone-links', {cache: 'no-store'});
            if (!response.ok) throw new Error('无法获取地址，请重试');
            const {urls} = await response.json();
            address.replaceChildren();
            for (const url of urls) {
                const mobileUrl = new URL(url);
                mobileUrl.searchParams.set('mobile', '1');
                if (selfId) mobileUrl.searchParams.set('receiver', selfId);
                address.add(new Option(mobileUrl.href, mobileUrl.href));
            }
            if (!urls.length) {qr.replaceChildren(); throw new Error('未检测到局域网地址，请先将电脑连接 Wi-Fi 或有线网络');}
            await render();
        } catch (error) { help.textContent = error.message; }
    });
    address.addEventListener('change', () => render().catch(error => {help.textContent = error.message;}));
    document.getElementById('phone-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {if (event.target === dialog) {
        const box = dialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    }});
});
