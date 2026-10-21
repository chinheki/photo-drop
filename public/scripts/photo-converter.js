/* PhotoDrop additions, GPL-3.0. Conversion happens locally before transfer. */
window.PhotoConverter = (() => {
    let decoderPromise;
    let busy = false;
    function timeout(promise, ms, message) {
        let timer;
        return Promise.race([promise, new Promise((_, reject) => {timer = setTimeout(() => reject(new Error(message)), ms);})]).finally(() => clearTimeout(timer));
    }
    function decodeHeic(file, type) {
        return new Promise((resolve, reject) => {
            let worker;
            const cleanup = () => {clearTimeout(timer); worker?.terminate();};
            const timer = setTimeout(() => {cleanup(); reject(new Error('HEIC 解码超过 45 秒，请减少图片尺寸或使用文件方式发送'));}, 45000);
            try {
                worker = new Worker('scripts/heic-worker.js', {type: 'module'});
                worker.onmessage = event => {cleanup(); event.data.error ? reject(new Error(event.data.error)) : resolve(event.data.blob);};
                worker.onerror = () => {cleanup(); reject(new Error('当前浏览器无法解码此 HEIC，请使用文件方式发送原文件'));};
                worker.postMessage({blob: file, type, quality: 0.95});
            } catch (error) {cleanup(); reject(error);}
        });
    }
    const preference = () => {
        try { return localStorage.getItem('photo-format') === 'png' ? 'png' : 'jpeg'; }
        catch { return 'jpeg'; }
    };
    function decoder() {
        if (!decoderPromise) decoderPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'scripts/libs/heic-to.js';
            script.onload = () => resolve(window.HeicTo);
            script.onerror = () => { decoderPromise = undefined; reject(new Error('HEIC 解码器加载失败，请检查连接后重试')); };
            document.head.append(script);
        });
        return decoderPromise;
    }
    async function isHeic(file) {
        if (/image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name)) return true;
        const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
        const text = String.fromCharCode(...bytes);
        return text.slice(4, 8) === 'ftyp' && /heic|heix|hevc|hevx|mif1|msf1/.test(text.slice(8));
    }
    async function nativeConvert(file, type, original = true) {
        const url = URL.createObjectURL(file);
        const image = new Image();
        let canvas;
        try {
            await timeout(new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => reject(new Error('浏览器无法解码此图片'));
                image.src = url;
            }), 8000, '浏览器解码超时');
            canvas = document.createElement('canvas');
            const scale = original ? 1 : Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
            canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
            canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
            if (!canvas.width || !canvas.height) throw new Error('图片尺寸无效');
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('当前设备无法分配图片内存，请分批发送');
            if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            const blob = await timeout(new Promise((resolve, reject) => canvas.toBlob(
                blob => blob ? resolve(blob) : reject(new Error('图片编码失败，请分批发送')), type, original ? 0.95 : 0.8)), 15000, '图片编码超时，请使用原图或文件方式发送');
            if (blob.type !== type) throw new Error('浏览器不支持所选输出格式');
            return blob;
        } finally {
            image.onload = image.onerror = null;
            image.src = '';
            URL.revokeObjectURL(url);
            if (canvas) { canvas.width = 0; canvas.height = 0; }
        }
    }
    async function convert(file, format = preference(), original = true) {
        const heic = await isHeic(file);
        if (!heic && !file.type.startsWith('image/')) return file;
        const type = format === 'png' ? 'image/png' : 'image/jpeg';
        if (original && !heic && file.type === type) return file;
        let blob;
        try { blob = await nativeConvert(file, type, original); }
        catch (error) {
            if (!heic) throw error;
            blob = await decodeHeic(file, type);
            if (!original) blob = await nativeConvert(blob, type, false);
        }
        if (!(blob instanceof Blob) || blob.type !== type || !blob.size) throw new Error('图片转换未产生有效文件');
        const name = file.name.replace(/\.[^.]+$/, '') + (format === 'png' ? '.png' : '.jpg');
        return new File([blob], name, { type, lastModified: file.lastModified });
    }
    async function prepare(files) {
        if (busy) throw new Error('上一批图片仍在转换，请稍候');
        busy = true;
        const status = document.getElementById('photo-status');
        const select = document.getElementById('photo-format');
        const format = preference();
        const original = document.getElementById('send-original')?.checked === true;
        if (select) select.disabled = true;
        try {
            const result = new Array(files.length);
            let next = 0, completed = 0, failure;
            const emit = (index, state, file, error) => window.dispatchEvent(new CustomEvent('photo-item', {detail:{index,state,file,error}}));
            const process = async () => {
                while (next < files.length && !failure) {
                    const index = next++;
                    emit(index, 'processing');
                    if (status) status.textContent = `正在处理图片 ${completed}/${files.length} · 同时处理最多 2 张`;
                    try {
                        result[index] = original && !await isHeic(files[index]) ? files[index] : await convert(files[index], format, original);
                        completed++;
                        emit(index, 'ready', result[index]);
                        if (status) status.textContent = `已处理 ${completed}/${files.length}`;
                    } catch (error) {
                        failure = new Error(`${files[index].name}：${error.message || '转换失败'}`);
                        emit(index, 'error', null, failure.message);
                    }
                }
            };
            await Promise.all([process(), process()]);
            if (failure) throw failure;
            if (status) status.textContent = '转换完成，等待接收方确认';
            window.dispatchEvent(new CustomEvent('photo-batch-ready'));
            return result;
        } catch (error) {
            window.dispatchEvent(new CustomEvent('photo-batch-error', {detail:error.message}));
            if (status) status.textContent = `未发送：${error.message}`;
            throw error;
        } finally {
            busy = false;
            if (select) select.disabled = false;
        }
    }
    window.addEventListener('DOMContentLoaded', () => {
        const select = document.getElementById('photo-format');
        select.value = preference();
        select.addEventListener('change', () => {
            try { localStorage.setItem('photo-format', select.value); }
            catch { document.getElementById('photo-status').textContent = '无法保存偏好，将使用 JPEG'; }
        });
        window.addEventListener('files-sent', () => {
            document.getElementById('photo-status').textContent = '发送完成，可以继续选择图片';
        });
        window.addEventListener('files-received', () => {
            document.getElementById('photo-status').textContent = '图片已收到，请保存到本机';
        });
    });
    return { convert, prepare, isHeic };
})();
