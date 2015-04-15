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

api.rpc.register_service(require('./auth_server'), 'auth_api', options);
api.rpc.register_service(require('./account_server'), 'account_api', options);
api.rpc.register_service(require('./system_server'), 'system_api', options);
api.rpc.register_service(require('./tier_server'), 'tier_api', options);
api.rpc.register_service(require('./node_server'), 'node_api', options);
api.rpc.register_service(require('./bucket_server'), 'bucket_api', options);
api.rpc.register_service(require('./object_server'), 'object_api', options);
