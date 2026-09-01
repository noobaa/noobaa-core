/* Copyright (C) 2016 NooBaa */
'use strict';

const child_process = require('child_process');

// catch process uncaught exceptions, and treat as a panic and exit after logging
// since restarting the process is the most stable way of recovery
process.on('uncaughtException', err => panic('process uncaughtException', err));

function panic(message, err) {
    // this printing is duplicated here in case LOOP_ON_PANIC is true (the process will not be exit)
    console.error('PANIC:', message, err.stack || err);
    while (process.env.LOOP_ON_PANIC === 'true') {
        console.warn('Encountered an error, holding the process on an infinite loop');
        child_process.execSync('sleep 10');
    }
    // to avoid cases where the process can exit without printing the error
    process.stderr.write('PANIC: ' + message + (err.stack || err) + '\n', () => {
        process.exit(1);
    });
}

// dump heap with kill -USR2 <pid>
const heapdump = require('heapdump');

const memory_monitor_config = {
    logging_threshold: (1024 + 512) * 1024 * 1024,
    heapdump: null,
    /** @type {null | (() => { live_bytes: number, pooled_bytes: number, in_use_bytes: number, waiting_bytes: number, pools: Array<{ buf_size: number, pooled_buffers: number, pooled_bytes: number, in_use_bytes: number, waiting_bytes: number, live_bytes: number }> })} */
    buffers_pool_stats: null,
};

setInterval(memory_monitor, 10000).unref();

function mb(bytes) {
    return ((Number(bytes) || 0) / 1024 / 1024).toFixed(0);
}

function enable_heapdump(name, next_mb, step_mb) {
    const c = memory_monitor_config;
    c.heapdump = {
        name: name || 'node',
        next: (next_mb || 512) * 1024 * 1024,
        step: (step_mb || 256) * 1024 * 1024,
    };
    return module.exports;
}

/**
 * Optional provider for buffer-pool memory stats (e.g. NSFS multi_buffer_pool).
 * Kept as a callback so panic.js does not hard-require heavy endpoint/sdk modules.
 * @param {typeof memory_monitor_config.buffers_pool_stats} fn
 */
function register_buffers_pool_stats(fn) {
    memory_monitor_config.buffers_pool_stats = fn;
}

function format_buf_size(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
    return `${(bytes / 1024).toFixed(0)}KB`;
}

function format_buffers_pool_stats(stats) {
    if (!stats || typeof stats !== 'object') return '';
    const pools = Array.isArray(stats.pools) ? stats.pools : [];
    const per_pool = pools
        .filter(p => p && (
            (p.live_bytes || 0) > 0 ||
            (p.waiting_bytes || 0) > 0 ||
            (p.allocated_bytes || 0) > 0
        ))
        .map(p => {
            const alloc_part = (p.allocated_count === undefined) ?
                '' : ` alloc=${mb(p.allocated_bytes)}/${p.allocated_count}`;
            const sem_cap_part = (p.sem_initial === undefined) ?
                '' : ` sem_cap=${mb(p.sem_initial)}`;
            return (
                `${format_buf_size(p.buf_size)}:live=${mb(p.live_bytes)}` +
                `(pooled=${mb(p.pooled_bytes)}/${p.pooled_buffers || 0}` +
                ` in_use=${mb(p.in_use_bytes)}` +
                alloc_part +
                sem_cap_part +
                (p.waiting_bytes ? ` wait=${mb(p.waiting_bytes)}` : '') +
                ((p.sem_value > p.sem_initial) ? ` sem_overflow=${mb(p.sem_value - p.sem_initial)}` : '') +
                `)`
            );
        })
        .join(' ');
    const alloc_total = (stats.allocated_bytes === undefined) ?
        '' : ` alloc ${mb(stats.allocated_bytes)}`;
    return (
        ` | pools_live ${mb(stats.live_bytes)} MB` +
        ` (pooled ${mb(stats.pooled_bytes)} in_use ${mb(stats.in_use_bytes)}` +
        alloc_total +
        (stats.waiting_bytes ? ` wait ${mb(stats.waiting_bytes)}` : '') +
        `)` +
        (per_pool ? ` | ${per_pool}` : '')
    );
}

function memory_monitor() {
    try {
        const m = process.memoryUsage();
        const c = memory_monitor_config;
        const h = c.heapdump;
        const current = m.heapUsed;
        // non_js ≈ allocator/native retention not explained by V8 heapTotal
        // unaccounted ≈ rss beyond heapUsed + external (jemalloc dirty pages, etc.)
        const non_js = m.rss - m.heapTotal;
        const unaccounted = m.rss - m.heapUsed - m.external;
        let pools_part = '';
        if (c.buffers_pool_stats) {
            try {
                pools_part = format_buffers_pool_stats(c.buffers_pool_stats());
            } catch (err) {
                pools_part = ` | pools_stats_error ${err.message}`;
            }
        }
        // Also trigger on rss: heapUsed alone misses native/buffer growth
        // (ArrayBuffers, jemalloc retention) that dominates NSFS RSS.
        const should_log = c.logging_threshold &&
            (c.logging_threshold <= current || c.logging_threshold <= m.rss);
        if (should_log) {
            console.log(
                `memory_monitor: rss ${mb(m.rss)} MB` +
                ` | heapUsed ${mb(m.heapUsed)} MB` +
                ` | heapTotal ${mb(m.heapTotal)} MB` +
                ` | external ${mb(m.external)} MB` +
                ` | arrayBuffers ${mb(m.arrayBuffers)} MB` +
                ` | non_js ${mb(non_js)} MB` +
                ` | unaccounted ${mb(unaccounted)} MB` +
                pools_part
            );
        }
        if (h && h.next && h.next <= current) {
            const size_mb = mb(current);
            const snapshot_name = `heapdump-${h.name}-${process.pid}-${new Date().toISOString()}-${size_mb}MB.heapsnapshot`;
            console.log(`memory_monitor: writing ${snapshot_name}`);
            heapdump.writeSnapshot(snapshot_name);
            const increase = current - h.next;
            const align = h.step - (increase % h.step);
            h.next += increase + align;
        }
    } catch (err) {
        console.error('memory_monitor got an error', err);
        // we saw cases where the number of open files (file descriptors) was a reason for uncaught error during the memory_monitor
        // we don't want the process to fail on that
        if (err.code !== 'EMFILE') throw err;
    }
}


exports.panic = panic;
exports.memory_monitor = memory_monitor;
exports.enable_heapdump = enable_heapdump;
exports.register_buffers_pool_stats = register_buffers_pool_stats;
