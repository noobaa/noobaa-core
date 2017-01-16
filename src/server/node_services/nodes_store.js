/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mongodb = require('mongodb');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const node_schema = require('./node_schema');
const mongo_utils = require('../../util/mongo_utils');
const mongo_client = require('../../util/mongo_client');

class NodesStore {

    constructor(test_suffix = '') {
        this._nodes = mongo_client.instance().define_collection({
            name: 'nodes' + test_suffix,
            schema: node_schema,
        });
    }

    static instance() {
        if (!NodesStore._instance) NodesStore._instance = new NodesStore();
        return NodesStore._instance;
    }

    make_node_id(id_str) {
        return new mongodb.ObjectId(id_str);
    }

    is_connected() {
        return mongo_client.instance().is_connected();
    }

    _validate_all(nodes, warn) {
        for (const node of nodes) {
            this._nodes.validate(node, warn);
        }
        return nodes;
    }


    /////////////
    // updates //
    /////////////

    create_node(req, node) {
        if (!node._id) {
            node._id = this.make_node_id();
        }
        return P.resolve()
            .then(() => this._nodes.validate(node))
            .then(() => this._nodes.col().insertOne(node))
            .catch(err => mongo_utils.check_duplicate_key_conflict(err, 'node'))
            .return(node);
    }

    update_node_by_id(node_id, updates, options) {
        return P.resolve(this._nodes.col().updateOne({
                _id: this.make_node_id(node_id)
            }, updates, options))
            .then(res => mongo_utils.check_update_one(res, 'node'));
    }

    bulk_update(items) {
        const bulk = this._nodes.col().initializeUnorderedBulkOp();
        let num_update = 0;
        let num_insert = 0;
        const nodes_to_store = new Map();
        for (const item of items) {
            nodes_to_store.set(item, _.cloneDeep(item.node));
            if (item.node_from_store) {
                this._nodes.validate(item.node, 'warn');
                const diff = mongo_utils.make_object_diff(
                    item.node, item.node_from_store);
                if (_.isEmpty(diff)) continue;
                bulk.find({
                    _id: item.node._id
                }).updateOne(diff);
                num_update += 1;
            } else {
                bulk.insert(item.node);
                num_insert += 1;
            }
        }
        if (!num_update && !num_insert) {
            return {
                updated: null,
                failed: null
            };
        }
        dbg.log0('bulk_update:',
            'executing bulk with', num_update, 'updates',
            'and', num_insert, 'inserts');
        return P.resolve()
            .then(() => new P(resolve => {
                // execute returns both the err and a result with details on the error
                // we use the result with details for fine grain error handling per bulk item
                // returning which items were updated and which failed
                // but in any case we always resolve the promise and not rejecting
                bulk.execute((err, result) => {
                    if (result.getWriteConcernError()) {
                        dbg.warn('bulk_update: WriteConcernError', result.getWriteConcernError());
                        return resolve({
                            updated: null,
                            failed: items
                        });
                    }
                    if (result.hasWriteErrors()) {
                        const failed = _.map(result.getWriteErrors(), e => items[e.index]);
                        dbg.warn('bulk_update:', result.getWriteErrorCount(), 'WriteErrors',
                            _.map(result.getWriteErrors(), e => ({
                                code: e.code,
                                index: e.index,
                                errmsg: e.errmsg,
                                item: items[e.index]
                            })));
                        return resolve({
                            updated: _.difference(items, failed),
                            failed: failed
                        });
                    }
                    if (err) {
                        dbg.warn('bulk_update: ERROR', err);
                        return resolve({
                            updated: null,
                            failed: items
                        });
                    }
                    dbg.log0('bulk_update: success', _.pick(result, 'nInserted', 'nModified'));
                    return resolve({
                        updated: items,
                        failed: null
                    });
                });
            }))
            .then(res => {
                if (res.updated) {
                    for (const item of res.updated) {
                        item.node_from_store = nodes_to_store.get(item);
                    }
                }
                return res;
            });
    }


    /////////////
    // queries //
    /////////////

    find_nodes(query, options) {
        return this._nodes.col().find(query, options)
            .toArray()
            .then(nodes => this._validate_all(nodes, 'warn'));
    }


    ///////////
    // utils //
    ///////////

    // for unit tests
    test_code_delete_all_nodes() {
        return P.resolve()
            .then(() => this._nodes.col().deleteMany({}));
    }

}


// EXPORTS
exports.NodesStore = NodesStore;
