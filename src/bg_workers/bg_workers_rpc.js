'use strict';

var api = require('../api');
var bg_workers_rpc = api.rpc;
var dbg = require('../util/debug_module')(__filename);

module.exports = bg_workers_rpc;

bg_workers_rpc.register_service(api.schema.cloud_sync_api, require('./cloud_sync_rpc'));

bg_workers_rpc.register_service(api.schema.bg_workers_api, {
    set_debug_level: function(req) {
        dbg.log0('Recieved set_debug_level req for level', req.rpc_params.level, 'mod', req.rpc_params.module);
        dbg.set_level(req.rpc_params.level, req.rpc_params.module);
        return;
    }
});
