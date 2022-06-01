/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const nb_native = require('../../util/nb_native');
const coverage_utils = require('../../util/coverage_utils');

function set_debug_level(req) {
    dbg.log0('Received set_debug_level req for level', req.rpc_params.level, 'mod', req.rpc_params.module);
    dbg.set_module_level(req.rpc_params.level, req.rpc_params.module);
    nb_native().fs.set_debug_level(req.rpc_params.level);
}

function get_coverage_data(req) {
    const coverage_data = coverage_utils.get_coverage_data();
    if (coverage_data) {
        dbg.log0('get_coverage_data: Returning data to collector');
    } else {
        dbg.warn('get_coverage_data: No data');
    }
    return { coverage_data };
}

// EXPORTS
exports.set_debug_level = set_debug_level;
exports.get_coverage_data = get_coverage_data;
