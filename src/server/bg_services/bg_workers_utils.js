/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);

const BG_WORKERS_MODES = Object.freeze({ DEFAULT: 'default', EXECUTOR: 'executor' });

/**
 * default runs the scanners and the other background workers.
 * executor only drains the queues, so more of these processes can share the work without scanning.
 * An omitted mode uses BG_WORKERS_MODE, or default when that env var is unset.
 * @param {string} [mode]
 * @returns {string}
 */
function get_bg_workers_mode(mode = process.env.BG_WORKERS_MODE || BG_WORKERS_MODES.DEFAULT) {
    if (Object.values(BG_WORKERS_MODES).includes(mode)) return mode;
    const str = `invalid BG_WORKERS_MODE: ${mode}`;
    dbg.error(str);
    throw new Error(str);
}

exports.BG_WORKERS_MODES = BG_WORKERS_MODES;
exports.get_bg_workers_mode = get_bg_workers_mode;
