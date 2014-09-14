// this module is written for both nodejs.
'use strict';

var _ = require('underscore');
var Q = require('q');
var restful_api = require('./restful_api');
var edge_node_api = require('./edge_node_api');
var account_server = require('./account_server');
// db models
var Account = require('./models/account');
var EdgeNode = require('./models/edge_node');
var EdgeBlock = require('./models/edge_block');


module.exports = new edge_node_api.Server({
    connect_edge_node: connect_edge_node,
    delete_edge_node: delete_edge_node,
}, [
    // middleware to verify the account session before any of this server calls
    account_server.account_session
]);


function connect_edge_node(req) {
    var info = _.pick(req.restful_params, 'name', 'ip', 'port');
    info.account = req.account.id; // see account_server.account_session
    info.heartbeat = new Date();
    return Q.fcall(function() {
        // query to find the node by account and name
        return EdgeNode.findOne({
            account: info.account,
            name: info.name,
        }).exec();
    }).then(function(edge_node) {
        if (edge_node) {
            // node exists - update its heartbeat
            edge_node.heartbeat = info.heartbeat;
            return Q.ninvoke(edge_node, 'save');
        } else {
            // doesn't exist - create the node
            return EdgeNode.create(info);
        }
    }).then(function(edge_node) {
        req.session.edge_node_id = edge_node._id;
        return undefined;
    });
}


function delete_edge_node(req) {
    var info = _.pick(req.restful_params, 'name');
    info.account = req.account.id; // see account_server.account_session
    return Q.fcall(function() {
        return EdgeNode.findOneAndRemove(info).exec();
    }).then(function() {
        delete req.session.edge_node_id;
        return undefined;
    });
}
