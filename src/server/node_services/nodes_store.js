/**
 *
 * NODES STORE
 *
 */
'use strict';

const _ = require('lodash');
const Ajv = require('ajv');
const mongodb = require('mongodb');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const js_utils = require('../../util/js_utils');
const mongo_utils = require('../../util/mongo_utils');
const mongo_client = require('../../util/mongo_client');
const schema_utils = require('../../util/schema_utils');

const NODES_COLLECTION = js_utils.deep_freeze({
    name: 'nodes',
    schema: schema_utils.strictify(require('./node_schema')),
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

class NodesStore {

    static instance() {
        if (!NodesStore._instance) {
            NodesStore._instance = new NodesStore();
        }
        return NodesStore._instance;
    }

    constructor() {
        mongo_client.instance().define_collection(NODES_COLLECTION);
        this._json_validator = new Ajv({
            formats: {
                idate: schema_utils.idate_format,
                objectid: val => mongo_utils.is_object_id(val)
            }
        });
        this._node_validator = this._json_validator.compile(NODES_COLLECTION.schema);
    }

    connect() {
        return mongo_client.instance().connect();
    }

    collection() {
        return mongo_client.instance().db.collection('nodes');
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
        return P.resolve(this.collection().insertOne(node))
            .catch(err => mongo_utils.check_duplicate_key_conflict(err, 'node'))
            .return(node);
    }

    update_node_by_id(node_id, updates, options) {
        return P.resolve(this.collection().updateOne({
            _id: this.make_node_id(node_id)
        }, updates, options));
    }

    bulk_update(items) {
        const bulk = this.collection().initializeUnorderedBulkOp();
        let num_update = 0;
        let num_insert = 0;
        for (const item of items) {
            if (item.node_from_store) {
                this.validate(item.node);
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
        if (!num_update && !num_insert) return;
        dbg.log0('bulk_update:',
            'executing bulk with', num_update, 'updates',
            'and', num_insert, 'inserts');
        return P.resolve(bulk.execute());
    }


    /////////////
    // queries //
    /////////////

    find_nodes(query, options) {
        return P.resolve(this.collection().find(query, options).toArray())
            .then(nodes => this.validate_list(nodes));
    }


    ///////////
    // utils //
    ///////////

    // for unit tests
    test_code_delete_all_nodes() {
        return P.resolve(this.collection().deleteMany({}));
    }

}


// EXPORTS
exports.NodesStore = NodesStore;
exports.instance = NodesStore.instance;
