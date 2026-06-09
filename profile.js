/* Copyright (C) 2026 NooBaa */
'use strict';

// /tmp/cdp/profile.js
const http = require('http');
const fs = require('fs');
const { WebSocket } = require('ws');
const seconds = Number(process.argv[2]) || 30;
const port = process.argv[3] || 9229;
const output = process.argv[4] || 'out.cpuprofile';

http.get(`http://localhost:${port}/json/list`, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
        const wsUrl = JSON.parse(data)[0].webSocketDebuggerUrl;
        const ws = new WebSocket(wsUrl);
        let id = 0;
        const pending = {};
        ws.on('message', msg => {
            const d = JSON.parse(msg);
            if (d.id && pending[d.id]) pending[d.id](d.result);
        });
        const call = m => new Promise(r => {
            const i = ++id;
            pending[i] = r;
            ws.send(JSON.stringify({ id: i, ...m }));
        });
        ws.on('open', async () => {
            await call({ method: 'Profiler.enable' });
            await call({ method: 'Profiler.start' });
            console.error(`profiling for ${seconds}s — start warp NOW`);
            await new Promise(r => setTimeout(r, seconds * 1000));
            const { profile } = await call({ method: 'Profiler.stop' });
            fs.writeFileSync(output, JSON.stringify(profile));
            console.error(`wrote ${output}`);
            process.exit(0);
        });
    });
});
