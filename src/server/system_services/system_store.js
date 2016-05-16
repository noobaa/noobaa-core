/**
 *
 * SYSTEM_STORE
 *
 */
'use strict';

const _ = require('lodash');
const Ajv = require('ajv');
const util = require('util');
const mongodb = require('mongodb');
const EventEmitter = require('events').EventEmitter;
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const js_utils = require('../../util/js_utils');
const server_rpc = require('../server_rpc');
const time_utils = require('../../util/time_utils');
const size_utils = require('../../util/size_utils');
const os_utils = require('../../util/os_utils');
const mongo_utils = require('../../util/mongo_utils');
const mongo_client = require('../../util/mongo_client').get_instance();
const schema_utils = require('../../util/schema_utils');

const COLLECTIONS = Object.freeze({
    clusters: require('./schemas/cluster_schema'),
    systems: require('./schemas/system_schema'),
    roles: require('./schemas/role_schema'),
    accounts: require('./schemas/account_schema'),
    buckets: require('./schemas/bucket_schema'),
    tieringpolicies: require('./schemas/tiering_policy_schema'),
    tiers: require('./schemas/tier_schema'),
    pools: require('./schemas/pool_schema'),
});

const INDEXES = js_utils.deep_freeze([{
    name: 'systems_by_name',
    collection: 'systems',
    key: 'name'
}, {
    name: 'accounts_by_email',
    collection: 'accounts',
    key: 'email'
}, {
    name: 'buckets_by_name',
    collection: 'buckets',
    context: 'system',
    key: 'name'
}, {
    name: 'tiering_policies_by_name',
    collection: 'tieringpolicies',
    context: 'system',
    key: 'name'
}, {
    name: 'tiers_by_name',
    collection: 'tiers',
    context: 'system',
    key: 'name'
}, {
    name: 'pools_by_name',
    collection: 'pools',
    context: 'system',
    key: 'name'
}, {
    name: 'roles_by_account',
    collection: 'roles',
    context: 'system',
    key: 'account._id',
    val: 'role',
    val_array: true,
}, {
    name: 'roles_by_system',
    collection: 'roles',
    context: 'account',
    key: 'system._id',
    val: 'role',
    val_array: true,
}, {
    name: 'cluster_by_server',
    collection: 'clusters',
    key: 'owner_secret'
}]);

const DB_INDEXES = js_utils.deep_freeze([{
    collection: 'systems',
    unique: true,
    fields: {
        name: 1,
        deleted: 1
    }
}, {
    collection: 'accounts',
    unique: true,
    fields: {
        email: 1,
        deleted: 1
    }
}, {
    collection: 'buckets',
    unique: true,
    fields: {
        system: 1,
        name: 1,
        deleted: 1
    }
}, {
    collection: 'tieringpolicies',
    unique: true,
    fields: {
        system: 1,
        name: 1,
        deleted: 1
    }
}, {
    collection: 'tiers',
    unique: true,
    fields: {
        system: 1,
        name: 1,
        deleted: 1
    }
}, {
    collection: 'pools',
    unique: true,
    fields: {
        system: 1,
        name: 1,
        deleted: 1
    }
}, {
    collection: 'clusters',
    unique: true,
    fields: {
        owner_secret: 1,
    }
}]);


/**
 *
 * SystemStoreData
 *
 */
class SystemStoreData {

    constructor(data) {
        this.time = Date.now();
    }

    get_by_id(id) {
        return id ? this.idmap[id.toString()] : null;
    }

    resolve_object_ids_paths(item, paths, allow_missing) {
        return mongo_utils.resolve_object_ids_paths(this.idmap, item, paths, allow_missing);
    }

    resolve_object_ids_recursive(item) {
        return mongo_utils.resolve_object_ids_recursive(this.idmap, item);
    }

    rebuild() {
        this.rebuild_idmap();
        this.rebuild_object_links();
        this.rebuild_indexes();
        this.rebuild_allowed_buckets_links();
    }

    rebuild_idmap() {
        this.idmap = {};
        _.each(COLLECTIONS, (schema, collection) => {
            let items = this[collection];
            _.each(items, item => {
                let idstr = item._id.toString();
                let existing = this.idmap[idstr];
                if (existing) {
                    dbg.error('SystemStoreData: id collision', item, existing);
                } else {
                    this.idmap[idstr] = item;
                }
                // keep backward compatible since mongoose exposes 'id'
                // for the sake of existing code that uses it
                // item.id = item._id;
            });
        });
    }

    rebuild_object_links() {
        _.each(COLLECTIONS, (schema, collection) => {
            let items = this[collection];
            _.each(items, item => this.resolve_object_ids_recursive(item));
        });
    }

    rebuild_indexes() {
        _.each(INDEXES, index => {
            _.each(this[index.collection], item => {
                let key = _.get(item, index.key || '_id');
                let val = index.val ? _.get(item, index.val) : item;
                let context = index.context ? _.get(item, index.context) : this;
                let map = context[index.name] = context[index.name] || {};
                if (index.val_array) {
                    map[key] = map[key] || [];
                    map[key].push(val);
                } else if (key in map) {
                    dbg.error('SystemStoreData:', index.name,
                        'collision on key', key, val, map[key]);
                } else {
                    map[key] = val;
                }
            });
        });
    }

    rebuild_allowed_buckets_links() {
        _.each(this.accounts, account => {
            // filter only the buckets that were resolved to existing buckets
            // this is to handle deletions of buckets that currently do not
            // update all the accounts.
            if (account.allowed_buckets) {
                account.allowed_buckets = _.filter(
                    account.allowed_buckets,
                    bucket => Boolean(bucket._id)
                );
            }
        });
    }

    check_indexes(collection, item) {
        _.each(INDEXES, index => {
            if (index.collection !== collection) return;
            let key = _.get(item, index.key || '_id');
            let context = index.context ? _.get(item, index.context) : this;
            if (!context) return;
            let map = context[index.name] = context[index.name] || {};
            if (!index.val_array) {
                let existing = map[key];
                if (existing && String(existing._id) !== String(item._id)) {
                    let err = new Error(index.name + ' collision on key ' + key);
                    err.rpc_code = 'CONFLICT';
                    throw err;
                }
            }
        });
    }

}


/**
 *
 * SystemStore
 *
 * loads data from the database and keeps in memory optimized way.
 *
 */
class SystemStore extends EventEmitter {

    static get_instance() {
        SystemStore._instance = SystemStore._instance || new SystemStore();
        return SystemStore._instance;
    }

    constructor() {
        super();
        this.START_REFRESH_THRESHOLD = 10 * 60 * 1000;
        this.FORCE_REFRESH_THRESHOLD = 60 * 60 * 1000;
        this._ajv = new Ajv({
            formats: {
                idate: schema_utils.idate_format,
                objectid: val => mongo_utils.is_object_id(val)
            }
        });
        _.each(COLLECTIONS, (schema, collection) => {
            schema_utils.make_strict_schema(schema);
            this._ajv.addSchema(schema, collection);
        });
        mongo_client.on('reconnect', () => {
            this._init_db_promise = null;
            this.load();
        });
        this.refresh_middleware = () => this.refresh();
        setTimeout(this.refresh_middleware, 1000);
    }

    refresh() {
        return P.fcall(() => {
            let load_time = 0;
            if (this.data) {
                load_time = this.data.time;
            }
            let since_load = Date.now() - load_time;
            if (since_load < this.START_REFRESH_THRESHOLD) {
                return this.data;
            } else if (since_load < this.FORCE_REFRESH_THRESHOLD) {
                this.load();
                return this.data;
            } else {
                return this.load();
            }
        });
    }

    load() {
        if (this._load_promise) return this._load_promise;
        dbg.log0('SystemStore: fetching ...');
        let new_data = new SystemStoreData();
        let millistamp = time_utils.millistamp();
        this._load_promise =
            P.fcall(() => this._register_for_changes())
            .then(() => this._read_data_from_db(new_data))
            .then(() => os_utils.read_server_secret())
            .then((secret) => {
                this._server_secret = secret;
                dbg.log0('SystemStore: fetch took', time_utils.millitook(millistamp));
                dbg.log0('SystemStore: fetch size', size_utils.human_size(JSON.stringify(new_data).length));
                dbg.log0('SystemStore: fetch data', util.inspect(new_data, {
                    depth: 4
                }));
                millistamp = time_utils.millistamp();
                new_data.rebuild();
                dbg.log0('SystemStore: rebuild took', time_utils.millitook(millistamp));
                this.data = new_data;
                this.emit('load');
                return this.data;
            })
            .finally(() => {
                this._load_promise = null;
            })
            .catch(err => {
                dbg.error('SystemStore: load failed', err.stack || err);
                throw err;
            });
        return this._load_promise;
    }


    _register_for_changes() {
        if (!this._registered_for_reconnect) {
            server_rpc.rpc.on('reconnect', conn => this._on_reconnect(conn));
            this._registered_for_reconnect = true;
        }
        return server_rpc.client.redirector.register_to_cluster();
    }

    _on_reconnect(conn) {
        if (conn.url.href === server_rpc.rpc.router.default) {
            dbg.log0('_on_reconnect:', conn.url.href);
            this.load();
        }
    }

    _read_data_from_db(target) {
        let non_deleted_query = {
            deleted: null
        };
        return this._init_db()
            .then(() => {
                return P.all(_.map(COLLECTIONS, (schema, collection) =>
                    mongo_client.db.collection(collection).find(non_deleted_query).toArray()
                    .then(res => {
                        target[collection] = res;
                    })
                    .then(res => _.each(res, item => this._check_schema(collection, item, 'read')))
                ));
            });
    }

    _init_db() {
        if (this._init_db_promise) return this._init_db_promise;
        this._init_db_promise = mongo_client.connect()
            .then(() => P.all(_.map(COLLECTIONS, (schema, collection) =>
                mongo_client.db.createCollection(collection))))
            .then(() => {
                return P.all(_.map(DB_INDEXES, index =>
                    mongo_client.db.collection(index.collection).createIndex(index.fields, {
                        unique: index.unique,
                        background: true
                    })
                    .then(res => dbg.log0('SystemStore index created',
                        index.collection, res))
                    .catch(err => dbg.error('SystemStore index FAILED',
                        index.collection, index, err))
                ));
            })
            .then(() => {
                this._db_inited = true;
                // now print the indexes just for fun
                return P.all(_.map(COLLECTIONS, (schema, collection) =>
                    mongo_client.db.collection(collection).indexes()
                    .then(res => dbg.log0('SystemStore indexes of',
                        collection, _.map(res, 'name')))
                ));
            })
            .then(null, function(err) {
                console.warn('ignoring error in _init_db:', err);
            });
        return this._init_db_promise;
    }

    _check_schema(collection, item, caller) {
        let validator = this._ajv.getSchema(collection);
        let is_valid = validator(item);
        if (!is_valid) {
            dbg.error('SystemStore: item not valid in collection',
                collection, validator.errors, item);
            if (caller === 'insert') {
                throw new Error('SystemStore: item not valid');
            }
        }
    }

    generate_id() {
        return new mongodb.ObjectId();
    }

    has_same_id(obj1, obj2) {
        return String(obj1._id) === String(obj2._id);
    }

    /**
     *
     * make_changes
     *
     * send batch of changes to the system db. example:
     *
     * make_changes({
     *   insert: {
     *      systems: [{...}],
     *      buckets: [{...}],
     *   },
     *   update: {
     *      systems: [{_id:123, ...}],
     *      buckets: [{_id:456, ...}],
     *   },
     *   remove: {
     *      systems: [123, 789],
     *   }
     * })
     *
     */
    make_changes(changes) {
        let bulk_per_collection = {};
        let now = new Date();
        dbg.log0('SystemStore.make_changes:', util.inspect(changes, {
            depth: 4
        }));

        let check_collection = collection => {
            if (!(collection in COLLECTIONS)) {
                throw new Error('SystemStore: make_changes bad collection name - ' + collection);
            }
        };
        let get_bulk = collection => {
            let bulk =
                bulk_per_collection[collection] =
                bulk_per_collection[collection] ||
                mongo_client.db.collection(collection).initializeUnorderedBulkOp();
            return bulk;
        };

        return P.when(this.refresh())
            .then(data => {

                _.each(changes.insert, (list, collection) => {
                    check_collection(collection);
                    _.each(list, item => {
                        this._check_schema(collection, item, 'insert');
                        data.check_indexes(collection, item);
                        get_bulk(collection).insert(item);
                    });
                });
                _.each(changes.update, (list, collection) => {
                    check_collection(collection);
                    _.each(list, item => {
                        data.check_indexes(collection, item);
                        let updates = _.omit(item, '_id');
                        let first_key;
                        _.forOwn(updates, (val, key) => {
                            first_key = key;
                            return false; // break loop immediately
                        });
                        if (first_key[0] !== '$') {
                            updates = {
                                $set: updates
                            };
                        }
                        // TODO how to _check_schema on update?
                        // if (updates.$set) {
                        //     this._check_schema(collection, updates.$set, 'update');
                        // }
                        get_bulk(collection).find({
                            _id: item._id
                        }).updateOne(updates);
                    });
                });
                _.each(changes.remove, (list, collection) => {
                    check_collection(collection);
                    _.each(list, id => {
                        get_bulk(collection).find({
                            _id: id
                        }).updateOne({
                            $set: {
                                deleted: now
                            }
                        });
                    });
                });

                return P.all(_.map(bulk_per_collection,
                    bulk => bulk.length && P.ninvoke(bulk, 'execute')));
            })
            .then(() =>
                // notify all the cluster (including myself) to reload
                server_rpc.client.redirector.publish_to_cluster({
                    method_api: 'cluster_member_api',
                    method_name: 'load_system_store',
                    target: ''
                })
            );
    }

    make_changes_in_background(changes) {
        this.bg_changes = this.bg_changes || {};
        _.mergeWith(this.bg_changes, changes, (a, b) => {
            if (_.isArray(a) && _.isArray(b)) {
                return a.concat(b);
            }
        });
        if (!this.bg_timeout) {
            this.bg_timeout = setTimeout(() => {
                let bg_changes = this.bg_changes;
                this.bg_changes = null;
                this.bg_timeout = null;
                this.make_changes(bg_changes);
            }, 3000);
        }
    }

    get_local_cluster_info() {
        let owner_secret = this.get_server_secret();
        let reply;
        _.each(this.data.clusters, function(cluster_info) {
            if (cluster_info.owner_secret === owner_secret) {
                reply = cluster_info;
            }
        });
        return reply;
    }

    get_server_secret() {
        return this._server_secret;
    }

}


// EXPORTS
exports.SystemStore = SystemStore;
exports.SystemStoreData = SystemStoreData;
exports.get_instance = SystemStore.get_instance;
