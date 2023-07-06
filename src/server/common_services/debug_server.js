/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const nb_native = require('../../util/nb_native');

function set_debug_level(req) {
    dbg.log0('Received set_debug_level req for level', req.rpc_params.level, 'mod', req.rpc_params.module);
    dbg.set_module_level(req.rpc_params.level, req.rpc_params.module);
    nb_native().fs.set_debug_level(req.rpc_params.level);
}

// EXPORTS
exports.set_debug_level = set_debug_level;
