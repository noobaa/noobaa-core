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

api.rpc.register_service(api.schema.auth_api, require('./auth_server'), options);
api.rpc.register_service(api.schema.account_api, require('./account_server'), options);
api.rpc.register_service(api.schema.system_api, require('./system_server'), options);
api.rpc.register_service(api.schema.tier_api, require('./tier_server'), options);
api.rpc.register_service(api.schema.node_api, require('./node_server'), options);
api.rpc.register_service(api.schema.bucket_api, require('./bucket_server'), options);
api.rpc.register_service(api.schema.object_api, require('./object_server'), options);
