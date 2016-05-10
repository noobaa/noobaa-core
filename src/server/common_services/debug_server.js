/**
 *
 * DEBUG_SERVER
 *
 */
'use strict';

var dbg = require('../../util/debug_module')(__filename);


function set_debug_level(req) {
    dbg.log0('Recieved set_debug_level req for level', req.rpc_params.level, 'mod', req.rpc_params.module);
    dbg.set_level(req.rpc_params.level, req.rpc_params.module);
    return;
}

function get_istanbul_collector(req) {
    //ONLY applicable during TESTRUN
    if (process.env.TESTRUN !== 'true') {
        console.error('Coverage only applicable in TESTRUN mode');
        throw new Error('Coverage only applicable in TESTRUN mode');
    } else {
        return {
            data: JSON.stringify(global.NOOBAA_COV),
        };
    }
}

// EXPORTS
exports.set_debug_level = set_debug_level;
exports.get_istanbul_collector = get_istanbul_collector;
