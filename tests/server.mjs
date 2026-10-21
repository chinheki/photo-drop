import express from 'express';
import {fileURLToPath} from 'node:url';
const app = express();
app.use(express.static(fileURLToPath(new URL('./', import.meta.url))));
app.use('/scripts', express.static(fileURLToPath(new URL('../public/scripts/', import.meta.url))));
app.listen(19092, '127.0.0.1', () => console.log('Conversion QA: http://127.0.0.1:19092/verify.html'));
