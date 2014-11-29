'use strict';

/**
 *
 * API FOLDER INDEX
 *
 */
module.exports = {
    rest_api: require('../util/rest_api'),

    auth_api: require('./auth_api'),
    account_api: require('./account_api'),
    system_api: require('./system_api'),
    tier_api: require('./tier_api'),
    node_api: require('./node_api'),

    bucket_api: require('./bucket_api'),
    object_api: require('./object_api'),
    ObjectClient: require('./object_client'),

    agent_api: require('./agent_api'),
    agent_host_api: require('./agent_host_api'),
};
