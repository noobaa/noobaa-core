'use strict';

var api = require('../api');

module.exports = {
    client: new api.Client()
};


// setup the rpc authorizer to check the request auth_token
var domain = '';
var options = {
    authorize: require('./auth_server').authorize
};

api.rpc.register_service(require('./auth_server'), 'auth_api', domain, options);
api.rpc.register_service(require('./account_server'), 'account_api', domain, options);
api.rpc.register_service(require('./system_server'), 'system_api', domain, options);
api.rpc.register_service(require('./tier_server'), 'tier_api', domain, options);
api.rpc.register_service(require('./node_server'), 'node_api', domain, options);
api.rpc.register_service(require('./bucket_server'), 'bucket_api', domain, options);
api.rpc.register_service(require('./object_server'), 'object_api', domain, options);
