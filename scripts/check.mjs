import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
let count = 0;
function check(path) {
    for (const entry of readdirSync(path,{withFileTypes:true})) {
        if (entry.name === 'libs') continue;
        const file = join(path,entry.name);
        if (entry.isDirectory()) check(file);
        else if (/\.(js|mjs)$/.test(entry.name)) {
            const result = spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
            if (result.status !== 0) process.exit(result.status || 1);
            count++;
        }
    }
}
check('server'); check('public/scripts');
console.log(`Checked ${count} application scripts`);
