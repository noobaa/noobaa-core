/* Copyright (C) 2016 NooBaa */
'use strict';

const { ObjectPool } = require('./object_pool');
const { make_array } = require('./js_utils');
const { performance } = require('perf_hooks');

const {
    MU_CONCURENT_MEASUREMENTS = 100,
    MU_SAMPLES_PER_MEASUREMENT = 2500,
    MU_CONCURENT_ACTIVE_SAMPLES = 5000
} = process.env;

const measurements = new Map();
const measurement_pool = new ObjectPool(MU_CONCURENT_MEASUREMENTS, {
    allocator: () => _init_measurement({}),
    initializer: _init_measurement,
    resize_policy: ObjectPool.resize_policy.NO_RESIZE
});
const handle_pool = new ObjectPool(MU_CONCURENT_ACTIVE_SAMPLES, {
    allocator: i => i,
    empty_value: -1,
    resize_policy: ObjectPool.resize_policy.NO_RESIZE
});
const timestamps = make_array(MU_CONCURENT_ACTIVE_SAMPLES, () => ({
    tag: '',
    time: -1,
}));

const report_columns = {
    'line': {
        title: '#',
        width: 4,
        value: (record, line_num) => line_num + 1,
    },
    tag: {
        title: 'Tag',
        width: 30,
        value: record => record.tag,
    },
    count: {
        title: 'Samples',
        width: 10,
        value: record => record.count,
    },
    max: {
        title: 'Max',
        width: 10,
        value: record => record.max.toFixed(3)
    },
    min: {
        title: 'Min',
        width: 10,
        value: record => record.min.toFixed(3)
    },
    aggr: {
        title: 'Aggr',
        width: 10,
        value: record => record.aggr.toFixed(3)
    },
    mean: {
        title: 'Mean',
        width: 10,
        value: record => record.mean.toFixed(3)
    },
    var: {
        title: 'Var',
        width: 10,
        value: record => record.var.toFixed(3)
    },
    percentile_50: {
        title: '50th_%',
        width: 10,
        value: record => record.percentile_50.toFixed(3)
    },
    percentile_75: {
        title: '75th_%',
        width: 10,
        value: record => record.percentile_75.toFixed(3)
    },
    percentile_90: {
        title: '90th_%',
        width: 10,
        value: record => record.percentile_90.toFixed(3)
    },
    percentile_99: {
        title: '99th_%',
        width: 10,
        value: record => record.percentile_99.toFixed(3)
    }
};

function _init_measurement(m) {
    m.tag = '';
    m.count = 0;
    m.next = 0;

    if (Array.isArray(m.samples)) {
        for (const sample of m.samples) {
            sample.start = -1;
            sample.end = -1;
        }
    } else {
        m.samples = make_array(MU_SAMPLES_PER_MEASUREMENT, () => ({
            start: -1,
            end: -1
        }));
    }

    return m;
}

function _update_measurement(tag, start, end) {
    const m = measurements.get(tag);
    if (!m) return;

    const len = m.samples.length;
    const sample = m.samples[m.next];
    sample.start = start;
    sample.end = end;
    m.next = (m.next + 1) % len;
    m.count = Math.min(m.count + 1, len);
}

// This function should not allocate (if possible)
// in order to not interfere with the sample.
function start_measurement(tag) {
    if (!tag) {
        console.warn(`start_measurement - Invalid tag, got: "${tag}" `);
    }

    if (!measurements.has(tag)) {
        const m = measurement_pool.alloc();
        if (m === null) return -1;

        // This is the single point where we allocate memory
        // during a measurement. and is done once per tag for the lifetime o
        // of the process.
        measurements.set(tag, m);
        m.tag = tag;
    }

    const handle = handle_pool.alloc();
    if (handle === -1) {
        return -1;
    }

    const timestamp = timestamps[handle];
    timestamp.tag = tag;

    // To minimize the effect of the code above on the measurement
    // we must take the start timestamp as late as possible.
    timestamp.time = performance.now();
    return handle;
}

// This function should not allocate (if poosible)
// in order to not interfere with the sample
function end_measurement(handle) {
    if (handle === -1) {
        return;
    }

    // To minimize the effect of the code below on the measurement
    // we must take the end timestamp as soon as possible.
    const now = performance.now();
    const ts = timestamps[handle];
    _update_measurement(ts.tag, ts.time, now);

    // Reset the timestamp.
    ts.tag = '';
    ts.time = -1;

    // release the handle for reuse.
    handle_pool.release(handle);
}

// This function should not allocate (if possible)
// in order to not interfere with the sample
function discard_measurement(handle) {
    if (handle === -1) {
        return;
    }
    const ts = timestamps[handle];
    ts.tag = '';
    ts.time = -1;
    handle_pool.release(handle);
}

function clear_measurement(tag) {
    const m = measurements.get(tag);
    if (m) {
        measurements.delete(tag);
        measurement_pool.release(m);
    }
}

function export_measurements() {
    const lines = [];
    for (const { tag, count, samples } of measurements.values()) {
        for (let i = 0; i < count; ++i) {
            const { start, end } = samples[i];
            lines.push([tag, start, end]);
        }
    }
    return lines
        .sort((l0, l1) => l0[1] - l1[1])
        .map(l => l.join(','))
        .join('\n');
}

function wrap_promise(tag, promise) {
    const h = start_measurement(tag);
    return promise.then(
        res => {
            end_measurement(h);
            return res;
        },
        err => {
            discard_measurement(h);
            throw err;
        }
    );
}

function calc_metrics() {
    const metrics = [];
    for (const { tag, samples, count } of measurements.values()) {
        if (count === 0) continue;
        const row = {
            tag,
            count,
            max: 0,
            min: Infinity,
            aggr: 0,
            mean: 0,
            var: 0,
            percentile_50: 0,
            percentile_75: 0,
            percentile_90: 0,
            percentile_99: 0
        };

        const sorted = samples
            .slice(0, count)
            .map(r => r.end - r.start)
            .sort((a, b) => a - b);

        for (const took of sorted) {
            row.max = Math.max(row.max, took);
            row.min = Math.min(row.min, took);
            row.aggr += took;
        }

        row.mean = row.aggr / row.count;
        for (const took of sorted) {
            row.var += ((took - row.mean) ** 2) / (row.count - 1);
        }

        row.percentile_50 = sorted[Math.floor(sorted.length * (50 / 100))];
        row.percentile_75 = sorted[Math.floor(sorted.length * (75 / 100))];
        row.percentile_90 = sorted[Math.floor(sorted.length * (90 / 100))];
        row.percentile_99 = sorted[Math.floor(sorted.length * (99 / 100))];

        metrics.push(row);
    }
    return metrics;
}

function produce_report(columns = Object.keys(report_columns)) {
    const records = calc_metrics();

    const headers = columns
        .map(name => {
            const column = report_columns[name];
            if (!column) return '';

            const { title, width } = column;
            return title.padEnd(width).slice(0, width);
        })
        .filter(Boolean)
        .join(' ');

    const cell_factories = columns.map(name => {
        const column = report_columns[name];
        if (!column) return () => '';

        const { value, width } = column;
        return (r, i) => String(value(r, i)).padEnd(width).slice(0, width);
    });

    const line_factory = (record, line_num) => cell_factories
        .map(f => f(record, line_num))
        .filter(Boolean)
        .join(' ');

    const lines = records
        .map(line_factory)
        .join('\n');

    return [
        `${'Date:'.padEnd(14)}${Date()}`,
        headers,
        lines,
        ''
    ].join('\n');
}

exports.start_measurement = start_measurement;
exports.end_measurement = end_measurement;
exports.discard_measurement = discard_measurement;
exports.clear_measurement = clear_measurement;
exports.wrap_promise = wrap_promise;
exports.export_measurements = export_measurements;
exports.calc_metrics = calc_metrics;
exports.produce_report = produce_report;
