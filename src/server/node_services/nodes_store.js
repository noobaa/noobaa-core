/**
 *
 * NODES STORE
 *
 */
'use strict';

const _ = require('lodash');
const moment = require('moment');
const mongodb = require('mongodb');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const Barrier = require('../../util/barrier');
const md_store = require('../object_services/md_store');
const NodeModel = require('./node_model');
const mongo_utils = require('../../util/mongo_utils');
const mongo_functions = require('../../util/mongo_functions');
const system_store = require('../system_services/system_store').get_instance();
// const size_utils = require('../../util/size_utils');

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
    latency_of_disk_read: 1,
});


/////////////////////
// single node ops //
/////////////////////


function make_node_id(id_str) {
    return new mongodb.ObjectId(id_str);
}

function create_node(req, node) {
    if (!node._id) {
        node._id = make_node_id();
    }
    return P.when(NodeModel.collection.insertOne(node))
        .catch(err => mongo_utils.check_duplicate_key_conflict(err, 'node'))
        .return(node);
}

function find_node_by_name(req) {
    return P.when(NodeModel.collection.findOne({
            system: req.system._id,
            name: req.rpc_params.name,
            deleted: null,
        }))
        .then(node => mongo_utils.check_entity_not_deleted(node, 'node'))
        .then(resolve_node_object_ids);
}

function find_node_by_address(req) {
    return P.when(NodeModel.collection.findOne({
            system: req.system._id,
            rpc_address: req.rpc_params.target,
            deleted: null,
        }))
        .then(node => mongo_utils.check_entity_not_deleted(node, 'node'))
        .then(resolve_node_object_ids);
}

/**
 * returns the updated node
 */
function update_node_by_name(req, updates, options) {
    return P.when(NodeModel.collection.updateOne({
        system: req.system._id,
        name: req.rpc_params.name,
        deleted: null,
    }, updates, options));
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
        .then(node => mongo_utils.check_entity_not_found(node, 'node'));
}

function update_node_by_id(node_id, updates, options) {
    return P.when(NodeModel.collection.updateOne({
        _id: make_node_id(node_id)
    }, updates, options));
}


////////////////////
// multi node ops //
////////////////////


function find_nodes(query, options) {
    return P.when(NodeModel.collection.find(query, options).toArray())
        .then(nodes => {
            if (!options.dont_resolve_object_ids) {
                var allow_missing = options && options.fields;
                _.each(nodes, node => resolve_node_object_ids(node, allow_missing));
            }
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

function bulk() {
    return NodeModel.collection.initializeUnorderedBulkOp();
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
    return P.when(NodeModel.collection.mapReduce(
            mongo_functions.map_aggregate_nodes,
            mongo_functions.reduce_sum, {
                query: query,
                scope: {
                    // have to pass variables to map/reduce with a scope
                    minimum_online_heartbeat: minimum_online_heartbeat,
                },
                out: {
                    inline: 1
                }
            }
        ))
        .then(res => {
            var bins = {};
            _.each(res, r => {
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


/**
 * finding node by id for heatbeat requests uses a barrier for merging DB calls.
 * this is a DB query barrier to issue a single query for concurrent heartbeat requests.
 */
const heartbeat_find_node_by_id_barrier = new Barrier({
    max_length: 200,
    expiry_ms: 500, // milliseconds to wait for others to join
    process: function(node_ids) {
        dbg.log2('heartbeat_find_node_by_id_barrier', node_ids.length);
        return find_nodes({
                deleted: null,
                _id: {
                    $in: node_ids
                },
            }, {
                // we are selective to reduce overhead
                fields: {
                    _id: 1,
                    ip: 1,
                    port: 1,
                    peer_id: 1,
                    storage: 1,
                    geolocation: 1,
                    rpc_address: 1,
                    base_address: 1,
                    version: 1,
                    debug_level: 1,
                }
            })
            .then(function(res) {
                var nodes_by_id = _.keyBy(res, '_id');
                return _.map(node_ids, function(node_id) {
                    return nodes_by_id[node_id];
                });
            });
    }
});


/**
 * counting node used storage for heatbeat requests uses a barrier for merging DB calls.
 * this is a DB query barrier to issue a single query for concurrent heartbeat requests.
 */
const heartbeat_count_node_storage_barrier = new Barrier({
    max_length: 200,
    expiry_ms: 500, // milliseconds to wait for others to join
    process: function(node_ids) {
        dbg.log2('heartbeat_count_node_storage_barrier', node_ids.length);
        return P.when(md_store.DataBlock.mapReduce({
                query: {
                    deleted: null,
                    node: {
                        $in: node_ids
                    },
                },
                map: mongo_functions.map_node_size,
                reduce: mongo_functions.reduce_sum
            }))
            .then(function(res) {

                // convert the map-reduce array to map of node_id -> sum of block sizes
                var nodes_storage = _.mapValues(_.keyBy(res, '_id'), 'value');
                return _.map(node_ids, function(node_id) {
                    dbg.log2('heartbeat_count_node_storage_barrier', nodes_storage, 'for ', node_ids, ' nodes_storage[', node_id, '] ', nodes_storage[node_id]);
                    return nodes_storage[node_id] || 0;
                });
            });
    }
});


/**
 * updating node timestamp for heatbeat requests uses a barrier for merging DB calls.
 * this is a DB query barrier to issue a single query for concurrent heartbeat requests.
 */
const heartbeat_update_node_timestamp_barrier = new Barrier({
    max_length: 200,
    expiry_ms: 500, // milliseconds to wait for others to join
    process: function(node_ids) {
        dbg.log2('heartbeat_update_node_timestamp_barrier', node_ids);
        return update_nodes({
            deleted: null,
            _id: {
                $in: node_ids
            },
        }, {
            $set: {
                heartbeat: new Date()
            }
        }).return();
    }
});



// EXPORTS
// single node ops
exports.make_node_id = make_node_id;
exports.create_node = create_node;
exports.find_node_by_name = find_node_by_name;
exports.find_node_by_address = find_node_by_address;
exports.update_node_by_name = update_node_by_name;
exports.delete_node_by_name = delete_node_by_name;
exports.update_node_by_id = update_node_by_id;
// multi node op
exports.find_nodes = find_nodes;
exports.count_nodes = count_nodes;
exports.populate_nodes_full = populate_nodes_full;
exports.populate_nodes_for_map = populate_nodes_for_map;
exports.update_nodes = update_nodes;
exports.bulk = bulk;
exports.aggregate_nodes_by_pool = aggregate_nodes_by_pool;
// util
exports.get_minimum_online_heartbeat = get_minimum_online_heartbeat;
exports.get_minimum_alloc_heartbeat = get_minimum_alloc_heartbeat;
exports.is_online_node = is_online_node;
exports.resolve_node_object_ids = resolve_node_object_ids;
exports.test_code_delete_all_nodes = test_code_delete_all_nodes;
exports.NODE_FIELDS_FOR_MAP = NODE_FIELDS_FOR_MAP;
exports.heartbeat_find_node_by_id_barrier = heartbeat_find_node_by_id_barrier;
exports.heartbeat_count_node_storage_barrier = heartbeat_count_node_storage_barrier;
exports.heartbeat_update_node_timestamp_barrier = heartbeat_update_node_timestamp_barrier;
