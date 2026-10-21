import {heicTo} from './libs/heic-next.js';
self.onmessage = async event => {
    try {
        const blob = await heicTo(event.data);
        self.postMessage({blob});
    } catch (error) { self.postMessage({error: error?.message || String(error)}); }
};
