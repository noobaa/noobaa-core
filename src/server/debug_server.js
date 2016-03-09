/* jshint node:true */
'use strict';

/**
 *
 * DEBUG_SERVER
 *
 */

var debug_server = {
    set_debug_level: set_debug_level,
    get_istanbul_collector: get_istanbul_collector
};

module.exports = debug_server;

var dbg = require('../util/debug_module')(__filename);

function set_debug_level(req) {
    dbg.log0('Recieved set_debug_level req for level', req.rpc_params.level, 'mod', req.rpc_params.module);
    dbg.set_level(req.rpc_params.level, req.rpc_params.module);
    return;
}

function get_istanbul_collector(req) {
    //ONLY applicable during TESTRUN
    if (!process.env.TESTRUN) {
        console.error('Coverage only applicable in TESTRUN mode');
        throw new Error('Coverage only applicable in TESTRUN mode');
    } else {
        return {
            data: new Buffer(global.NOOBAA_COV.toString()),
        };
    }
}
