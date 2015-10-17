/* jshint node:true */
'use strict';

/**
 *
 * DEBUG_SERVER
 *
 */

var debug_server = {
    set_debug_level: set_debug_level
};

module.exports = debug_server;

var dbg = require('../util/debug_module')(__filename);

function set_debug_level(req) {
    dbg.log0('Recieved set_debug_level req for level', req.rpc_params.level, 'mod', req.rpc_params.module);
    dbg.set_level(req.rpc_params.level, req.rpc_params.module);
    return;

}
