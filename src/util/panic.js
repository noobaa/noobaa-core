/* Copyright (C) 2016 NooBaa */
'use strict';

const child_process = require('child_process');
const nb_native = require('../util/nb_native');

// catch process uncaught exceptions, and treat as a panic and exit after logging
// since restarting the process is the most stable way of recovery
process.on('uncaughtException', err => panic('process uncaughtException', err));

function panic(message, err) {
    console.error('PANIC:', message, err.stack || err);
    while (process.env.LOOP_ON_PANIC === 'true') {
        console.warn('Encountered an error, holding the process on an infinite loop');
        child_process.execSync('sleep 10');
    }
    process.exit(1);
}

// dump heap with kill -USR2 <pid>
const heapdump = require('heapdump');

const memory_monitor_config = {
    logging_threshold: (512) * 1024 * 1024,
    heapdump: null,
    malloc_print: null,
};

setInterval(memory_monitor, 10000).unref();
if (process.env.ENABLE_MALLOC_STATS === 'true') {
    enable_malloc_print();
}
if (process.env.ENABLE_HEAPDUMP === 'true') {
    enable_heapdump();
}

function enable_heapdump(name, next_mb, step_mb) {
    const c = memory_monitor_config;
    c.heapdump = {
        name: name || 'node',
        next: (next_mb || 512) * 1024 * 1024,
        step: (step_mb || 256) * 1024 * 1024,
    };
}

function enable_malloc_print(name, next_mb, step_mb) {
    const c = memory_monitor_config;
    c.malloc_print = {
        name: name || 'node',
        next: (next_mb || 256) * 1024 * 1024,
        step: (step_mb || 128) * 1024 * 1024,
    };
}

function memory_monitor() {
    const m = process.memoryUsage();
    const c = memory_monitor_config;
    const h = c.heapdump;
    const mp = c.malloc_print;
    const current = Math.max(m.rss, m.heapTotal);
    if (c.logging_threshold &&
        c.logging_threshold <= current) {
        const usage = (m.heapUsed / 1024 / 1024).toFixed(0);
        const total = (m.heapTotal / 1024 / 1024).toFixed(0);
        const resident = (m.rss / 1024 / 1024).toFixed(0);
        const external = (m.external / 1024 / 1024).toFixed(0);
        const array_buffers = (m.arrayBuffers / 1024 / 1024).toFixed(0);
        console.log(`memory_monitor: heap ${usage} MB | total ${total} MB | resident ${resident} MB | ` +
            `external ${external} MB | array_buffers ${array_buffers} MB`);
    }
    if (mp && mp.next && mp.next <= current) {
        mp.next = current + mp.step - (current % mp.step);
        console.log(`memory_monitor: writing jemalloc stats report`, current, mp.next);
        nb_native().malloc.print_stats();
    }
    if (h && h.next && h.next <= current) {
        const size_mb = (current / 1024 / 1024).toFixed(0);
        const snapshot_name = `heapdump-${h.name}-${process.pid}-${new Date().toISOString()}-${size_mb}MB.heapsnapshot`;
        h.next = current + h.step - (current % h.step);
        console.log(`memory_monitor: writing ${snapshot_name}`, current, h.next);
        heapdump.writeSnapshot(snapshot_name);
    }
}


exports.panic = panic;
exports.memory_monitor = memory_monitor;
exports.enable_heapdump = enable_heapdump;
exports.enable_malloc_print = enable_malloc_print;
