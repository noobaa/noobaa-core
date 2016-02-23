'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var db = require('../db');
// var dbg = require('../../util/debug_module')(__filename);
var size_utils = require('../../util/size_utils');
var mongo_utils = require('../../util/mongo_utils');
var system_store = require('./system_store');
var mongodb = require('mongodb');
var moment = require('moment');
var NodeModel = require('./node_model');

const NODE_FIELDS_FOR_MAP = Object.freeze({
    _id: 1,
    ip: 1,
    name: 1,
    system: 1,
    pool: 1,
    srvmode: 1,
    heartbeat: 1,
    rpc_address: 1,
    storage: 1,
});

module.exports = {
    // single node ops
    make_node_id: make_node_id,
    create_node: create_node,
    find_node_by_name: find_node_by_name,
    update_node_by_name: update_node_by_name,
    delete_node_by_name: delete_node_by_name,
    update_node_by_id: update_node_by_id,
    // multi node ops
    find_nodes: find_nodes,
    count_nodes: count_nodes,
    populate_nodes_full: populate_nodes_full,
    populate_nodes_for_map: populate_nodes_for_map,
    update_nodes: update_nodes,
    aggregate_nodes_by_pool: aggregate_nodes_by_pool,
    // utils
    get_minimum_online_heartbeat: get_minimum_online_heartbeat,
    get_minimum_alloc_heartbeat: get_minimum_alloc_heartbeat,
    is_online_node: is_online_node,
    resolve_node_object_ids: resolve_node_object_ids,
    test_code_delete_all_nodes: test_code_delete_all_nodes,
    NODE_FIELDS_FOR_MAP: NODE_FIELDS_FOR_MAP,
};

/////////////////////
// single node ops //
/////////////////////


function make_node_id(id_str) {
    return new mongodb.ObjectId(id_str);
}

function create_node(req, node) {
    node._id = make_node_id();
    return P.when(NodeModel.collection.insertOne(node))
        .catch(db.check_already_exists(req, 'node'))
        .return(node);
}

function find_node_by_name(req) {
    return P.when(NodeModel.collection.findOne({
            system: req.system._id,
            name: req.rpc_params.name,
            deleted: null,
        }))
        .then(db.check_not_deleted(req, 'node'))
        .then(resolve_node_object_ids);
}

/**
 * returns the updated node
 */
function update_node_by_name(req, updates) {
    return P.when(NodeModel.collection.findOneAndUpdate({
            system: req.system._id,
            name: req.rpc_params.name,
            deleted: null,
        }, updates))
        .then(db.check_not_deleted(req, 'node'));
}

function delete_node_by_name(req) {
    return P.when(NodeModel.collection.findOneAndUpdate({
            system: req.system._id,
            name: req.rpc_params.name,
            deleted: null,
        }, {
            $set: {
                deleted: new Date()
            }
        }))
        .then(db.check_not_found(req, 'node'));
}

function update_node_by_id(node_id, updates) {
    return P.when(NodeModel.collection.findOneAndUpdate({
        _id: make_node_id(node_id)
    }, updates));
}


////////////////////
// multi node ops //
////////////////////


function find_nodes(query, options) {
    return P.when(NodeModel.collection.find(query, options).toArray())
        .then(nodes => {
            var allow_missing = options && options.fields;
            _.each(nodes, node => resolve_node_object_ids(node, allow_missing));
            return nodes;
        });
}

function count_nodes(query) {
    return P.when(NodeModel.collection.count(query));
}

function populate_nodes_full(docs, doc_path) {
    return mongo_utils.populate(docs, doc_path, NodeModel.collection);
}

function populate_nodes_for_map(docs, doc_path) {
    return mongo_utils.populate(docs, doc_path, NodeModel.collection, NODE_FIELDS_FOR_MAP);
}

function update_nodes(query, updates) {
    return P.when(NodeModel.collection.updateMany(query, updates));
}


/**
 *
 * aggregate_nodes_by_pool
 *
 * counts the number of nodes and online nodes
 * and sum of storage (allocated, used) for the entire query, and per pool.
 *
 * @return <Object> the '' key represents the entire query and others are pool ids.
 *      each pool value is an object with properties: total, free, alloc, used, count, online.
 *
 */
function aggregate_nodes_by_pool(query) {
    var minimum_online_heartbeat = get_minimum_online_heartbeat();
    var map_func = function() {
        /* global emit */
        emit(['', 'total'], this.storage.total);
        emit(['', 'free'], this.storage.free);
        emit(['', 'used'], this.storage.used);
        emit(['', 'alloc'], this.storage.alloc);
        emit(['', 'count'], 1);
        var online = (!this.srvmode && this.heartbeat >= minimum_online_heartbeat);
        if (online) {
            emit(['', 'online'], 1);
        }
        if (this.pool) {
            emit([this.pool, 'total'], this.storage.total);
            emit([this.pool, 'free'], this.storage.free);
            emit([this.pool, 'used'], this.storage.used);
            emit([this.pool, 'alloc'], this.storage.alloc);
            emit([this.pool, 'count'], 1);
            if (online) {
                emit([this.pool, 'online'], 1);
            }
        }
    };
    var reduce_func = size_utils.reduce_sum;
    return P.when(NodeModel.collection.mapReduce(map_func, reduce_func, {
        query: query,
        scope: {
            // have to pass variables to map/reduce with a scope
            minimum_online_heartbeat: minimum_online_heartbeat,
        },
        out: {
            inline: 1
        }
    })).then(res => {
        var bins = {};
        _.each(res.results, r => {
            var t = bins[r._id[0]] = bins[r._id[0]] || {};
            t[r._id[1]] = r.value;
        });
        return bins;
    });
}


///////////
// utils //
///////////

function get_minimum_online_heartbeat() {
    return moment().subtract(5, 'minutes').toDate();
}

function get_minimum_alloc_heartbeat() {
    return moment().subtract(2, 'minutes').toDate();
}

function is_online_node(node) {
    return !node.srvmode && node.heartbeat >= get_minimum_online_heartbeat();
}


const NODE_OBJECT_IDS_PATHS = [
    'system',
    'pool'
];

function resolve_node_object_ids(node, allow_missing) {
    return system_store.data.resolve_object_ids_paths(node, NODE_OBJECT_IDS_PATHS, allow_missing);
}

// for unit tests
function test_code_delete_all_nodes() {
    return P.when(NodeModel.collection.deleteMany({}));
}
