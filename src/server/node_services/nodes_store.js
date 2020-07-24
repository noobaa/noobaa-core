/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const mongodb = require('mongodb');

const dbg = require('../../util/debug_module')(__filename);
const node_schema = require('./node_schema');
const db_client = require('../../util/db_client');
const P = require('../../util/promise');

class NodesStore {

    constructor(test_suffix = '') {
        this._nodes = db_client.instance().define_collection({
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
        return db_client.instance().is_connected();
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
        return P.resolve().then(async () => {
            if (!node._id) {
                node._id = this.make_node_id();
            }
            try {
                this._nodes.validate(node);
                await this._nodes.insertOne(node);
            } catch (err) {
                db_client.instance().check_duplicate_key_conflict(err, 'node');
            }
            return node;
        });
    }

    async db_delete_nodes(node_ids) {
        if (!node_ids || !node_ids.length) return;
        dbg.warn('Removing the following nodes from DB:', node_ids);
        return this._nodes.deleteMany({
            _id: {
                $in: node_ids
            },
            deleted: { $exists: true }
        });
    }

    update_node_by_id(node_id, updates, options) {
        return P.resolve().then(async () => {
            const res = await this._nodes.updateOne({
                _id: this.make_node_id(node_id)
            }, updates, options);
            db_client.instance().check_update_one(res, 'node');
        });
    }

    async _bulk_update(items, nodes_to_store) {
        const bulk = this._nodes.initializeUnorderedBulkOp();
        let num_update = 0;
        let num_insert = 0;
        for (const item of items) {
            nodes_to_store.set(item, _.cloneDeep(item.node));
            if (item.node_from_store) {
                this._nodes.validate(item.node, 'warn');
                const diff = db_client.instance().make_object_diff(
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
        // execute returns both the err and a result with details on the error
        // we use the result with details for fine grain error handling per bulk item
        // returning which items were updated and which failed
        // but in any case we always resolve the promise and not rejecting
        try {
            const result = await bulk.execute();
            if (result && result.getWriteConcernError()) {
                dbg.warn('bulk_update: WriteConcernError', result.getWriteConcernError());
                return {
                    updated: null,
                    failed: items
                };
            }
            if (result && result.hasWriteErrors()) {
                const write_errors = /** @type {mongodb.WriteError[]} */ (result.getWriteErrors());
                const failed = _.map(write_errors, e => items[e.index]);
                dbg.warn('bulk_update:', result.getWriteErrorCount(), 'WriteErrors',
                    _.map(write_errors, e => ({
                        code: e.code,
                        index: e.index,
                        errmsg: e.errmsg,
                        item: items[e.index]
                    })));
                return {
                    updated: _.difference(items, failed),
                    failed: failed
                };
            }
            dbg.log0('bulk_update: success', _.pick(result, 'nInserted', 'nModified'));
            return {
                updated: items,
                failed: null
            };
        } catch (err) {
            dbg.warn('bulk_update: ERROR', err);
            return {
                updated: null,
                failed: items
            };
        }
    }

    async bulk_update(items) {
        const nodes_to_store = new Map();
        const res = await this._bulk_update(items, nodes_to_store);
        if (res.updated) {
            for (const item of res.updated) {
                item.node_from_store = nodes_to_store.get(item);
            }
        }
        return res;
    }

    /////////////
    // queries //
    /////////////

    /**
     * 
     * @param {Object} query 
     * @param {number} [limit]
     * @param {Object} [fields] 
     */
    async find_nodes(query, limit, fields) {
        const nodes = await this._nodes.find(query, { limit, projection: fields });
        return this._validate_all(nodes, 'warn');
    }

    async get_hidden_by_id(id) {
        return this._nodes.findOne({
            _id: id,
            $or: [
                { 'deleted': { $ne: null } },
                { 'force_hide': { $ne: null } },
            ]
        });
    }

    async has_any_nodes_for_pool(pool_id) {
        const obj = await this._nodes.findOne({
            pool: pool_id,
        });
        return Boolean(obj);
    }

    async count_total_nodes() {
        return this._nodes.countDocuments({}); // maybe estimatedDocumentCount()
    }

}

/** @type {NodesStore} */
NodesStore._instance = undefined;

// EXPORTS
exports.NodesStore = NodesStore;
