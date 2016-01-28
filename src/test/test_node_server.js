'use strict';

// var _ = require('lodash');
var P = require('../util/promise');
var mocha = require('mocha');
// var assert = require('assert');
var size_utils = require('../util/size_utils');
var coretest = require('./coretest');
var os_util = require('../util/os_util');

mocha.describe('node_server', function() {

    var client = coretest.new_client();

    mocha.it('works', function() {
        this.timeout(20000);
        return P.resolve()
            .then(() => client.account.create_account({
                name: 'test-node-system',
                email: 'test-node-system@coretest.coretest',
                password: 'tululu',
            }))
            .then(res => client.options.auth_token = res.token)
            .then(() => client.node.heartbeat({
                name: 'haha',
                version: '0',
                port: 0,
                base_address: 'base_address',
                rpc_address: 'rpc_address',
                storage: {
                    alloc: 10 * size_utils.GIGABYTE,
                    used: size_utils.GIGABYTE,
                },
                os_info: os_util.os_info(),
            }))
            // .then(() => client.node.read_node({
                // name: 'haha'
            // }))
            .then(() => client.node.list_nodes({}))
            .then(() => client.node.delete_node({
                name: 'haha'
            }));
    });

});
