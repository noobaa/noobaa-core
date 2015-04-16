'use strict';

var api = require('../api');

module.exports = {
    client: new api.Client()
};

var options = {
    domain: '*',
    // setup the rpc authorizer to check the request auth_token
    authorize: require('./auth_server').authorize,
    // tell rpc to always use ws transport when sending to peers
    use_ws_to_peer: true
};

api.rpc.register_service(require('./auth_server'), api.schema.auth_api, options);
api.rpc.register_service(require('./account_server'), api.schema.account_api, options);
api.rpc.register_service(require('./system_server'), api.schema.system_api, options);
api.rpc.register_service(require('./tier_server'), api.schema.tier_api, options);
api.rpc.register_service(require('./node_server'), api.schema.node_api, options);
api.rpc.register_service(require('./bucket_server'), api.schema.bucket_api, options);
api.rpc.register_service(require('./object_server'), api.schema.object_api, options);
