/**
 *
 * NODES STORE
 *
 */
'use strict';

const _ = require('lodash');
const Ajv = require('ajv');
const moment = require('moment');
const mongodb = require('mongodb');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const js_utils = require('../../util/js_utils');
const mongo_utils = require('../../util/mongo_utils');
const mongo_client = require('../../util/mongo_client').get_instance();
const system_store = require('../system_services/system_store').get_instance();
const schema_utils = require('../../util/schema_utils');
const mongo_functions = require('../../util/mongo_functions');

const NODES_COLLECTION = js_utils.deep_freeze({
    name: 'nodes',
    schema: schema_utils.strictify(require('./node_model')),
    db_indexes: [{
        fields: {
            system: 1,
            pool: 1,
            name: 1,
            deleted: 1, // allow to filter deleted
        },
        options: {
            unique: true,
        }
    }, {
        fields: {
            peer_id: 1,
            deleted: 1, // allow to filter deleted
        },
        options: {
            unique: true,
            sparse: true,
        }
    }]
});

const NODE_FIELDS_FOR_MAP = js_utils.deep_freeze({
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

const NODE_OBJECT_IDS_PATHS = js_utils.deep_freeze([
    'system',
    'pool'
]);


class NodesStore {

    static get_instance() {
        NodesStore._instance = NodesStore._instance || new NodesStore();
        return NodesStore._instance;
    }

    constructor() {
        this.NODE_FIELDS_FOR_MAP = NODE_FIELDS_FOR_MAP;
        this.NODE_OBJECT_IDS_PATHS = NODE_OBJECT_IDS_PATHS;
        mongo_client.define_collection(NODES_COLLECTION);
        this._json_validator = new Ajv({
            formats: {
                idate: schema_utils.idate_format,
                objectid: val => mongo_utils.is_object_id(val)
            }
        });
        this._node_validator = this._json_validator.compile(NODES_COLLECTION.schema);
    }

    collection() {
        return mongo_client.db.collection('nodes');
    }

    validate(node, fail) {
        if (!this._node_validator(node)) {
            dbg.warn('BAD NODE SCHEMA', node, 'ERRORS', this._node_validator.errors);
            if (fail) {
                throw new Error('BAD NODE SCHEMA');
            }
        }
        return node;
    }

    validate_list(nodes, fail) {
        _.each(nodes, node => this.validate(node, fail));
        return nodes;
    }

    make_node_id(id_str) {
        return new mongodb.ObjectId(id_str);
    }


    /////////////
    // updates //
    /////////////


    create_node(req, node) {
        if (!node._id) {
            node._id = this.make_node_id();
        }
        this.validate(node, 'fail');
        return P.when(this.collection().insertOne(node))
            .catch(err => mongo_utils.check_duplicate_key_conflict(err, 'node'))
            .return(node);
    }

    /**
     * returns the updated node
     */
    update_node_by_name(req, updates, options) {
        return P.when(this.collection().updateOne({
            system: req.system._id,
            name: req.rpc_params.name,
            deleted: null,
        }, updates, options));
    }

    delete_node_by_name(req) {
        return P.when(this.collection().findOneAndUpdate({
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

    update_node_by_id(node_id, updates, options) {
        return P.when(this.collection().updateOne({
            _id: this.make_node_id(node_id)
        }, updates, options));
    }

    update_nodes(query, updates) {
        return P.when(this.collection().updateMany(query, updates));
    }

    bulk_update(items) {
        const bulk = this.collection().initializeUnorderedBulkOp();
        let num_update = 0;
        let num_insert = 0;
        for (const item of items) {
            if (item.node_from_store) {
                this.validate(item.node);
                const diff = js_utils.pick_object_diff(item.node, item.node_from_store);
                if (_.isEmpty(diff)) continue;
                bulk.find({
                    _id: item.node._id
                }).updateOne({
                    $set: diff
                });
                num_update += 1;
            } else {
                bulk.insert(item.node);
                num_insert += 1;
            }
        }
        if (!num_update && !num_insert) return;
        dbg.log0('bulk_update:',
            'executing bulk with', num_update, 'updates',
            'and', num_insert, 'inserts');
        return P.ninvoke(bulk, 'execute');
    }




    /////////////
    // queries //
    /////////////


    find_node_by_name(req) {
        return P.when(this.collection().findOne({
                system: req.system._id,
                name: req.rpc_params.name,
                deleted: null,
            }))
            .then(node => mongo_utils.check_entity_not_deleted(node, 'node'))
            .then(node => this.validate(node))
            .then(node => this.resolve_node_object_ids(node));
    }

    find_node_by_address(req) {
        return P.when(this.collection().findOne({
                system: req.system._id,
                rpc_address: req.rpc_params.target,
                deleted: null,
            }))
            .then(node => mongo_utils.check_entity_not_deleted(node, 'node'))
            .then(node => this.validate(node))
            .then(node => this.resolve_node_object_ids(node));
    }

    find_nodes(query, options) {
        return P.when(this.collection().find(query, options).toArray())
            .then(nodes => this.validate_list(nodes));
    }

    count_nodes(query) {
        return P.when(this.collection().count(query));
    }

    populate_nodes_full(docs, doc_path) {
        return mongo_utils.populate(docs, doc_path, this.collection());
    }

    populate_nodes_for_map(docs, doc_path) {
        return mongo_utils.populate(docs, doc_path, this.collection(), NODE_FIELDS_FOR_MAP);
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
    aggregate_nodes_by_pool(query) {
        var minimum_online_heartbeat = this.get_minimum_online_heartbeat();
        return P.when(this.collection().mapReduce(
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

    get_minimum_online_heartbeat() {
        return moment().subtract(5, 'minutes').toDate();
    }

    get_minimum_alloc_heartbeat() {
        return moment().subtract(2, 'minutes').toDate();
    }

    is_online_node(node) {
        return !node.srvmode && node.heartbeat >= this.get_minimum_online_heartbeat();
    }

    resolve_node_object_ids(node, allow_missing) {
        return system_store.data.resolve_object_ids_paths(
            node, NODE_OBJECT_IDS_PATHS, allow_missing);
    }

    // for unit tests
    test_code_delete_all_nodes() {
        return P.when(this.collection().deleteMany({}));
    }

}


// EXPORTS
exports.NodesStore = NodesStore;
exports.get_instance = NodesStore.get_instance;
