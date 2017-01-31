/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
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
const mongo_client = require('../../util/mongo_client');

const COLLECTIONS = [{
    name: 'clusters',
    schema: require('./schemas/cluster_schema'),
    mem_indexes: [{
        name: 'cluster_by_server',
        key: 'owner_secret'
    }],
    db_indexes: [{
        fields: {
            owner_secret: 1,
        },
        options: {
            unique: true,
        }
    }],
}, {
    name: 'systems',
    schema: require('./schemas/system_schema'),
    mem_indexes: [{
        name: 'systems_by_name',
        key: 'name'
    }],
    db_indexes: [{
        fields: {
            name: 1,
            deleted: 1
        },
        options: {
            unique: true,
        }
    }],
}, {
    name: 'roles',
    schema: require('./schemas/role_schema'),
    mem_indexes: [{
        name: 'roles_by_account',
        context: 'system',
        key: 'account._id',
        val: 'role',
        val_array: true,
    }, {
        name: 'roles_by_system',
        context: 'account',
        key: 'system._id',
        val: 'role',
        val_array: true,
    }],
    db_indexes: [],
}, {
    name: 'accounts',
    schema: require('./schemas/account_schema'),
    mem_indexes: [{
        name: 'accounts_by_email',
        key: 'email'
    }],
    db_indexes: [{
        fields: {
            email: 1,
            deleted: 1
        },
        options: {
            unique: true,
        }
    }],
}, {
    name: 'buckets',
    schema: require('./schemas/bucket_schema'),
    mem_indexes: [{
        name: 'buckets_by_name',
        context: 'system',
        key: 'name'
    }],
    db_indexes: [{
        fields: {
            system: 1,
            name: 1,
            deleted: 1
        },
        options: {
            unique: true,
        }
    }],
}, {
    name: 'tieringpolicies',
    schema: require('./schemas/tiering_policy_schema'),
    mem_indexes: [{
        name: 'tiering_policies_by_name',
        context: 'system',
        key: 'name'
    }],
    db_indexes: [{
        fields: {
            system: 1,
            name: 1,
            deleted: 1
        },
        options: {
            unique: true,
        }
    }],
}, {
    name: 'tiers',
    schema: require('./schemas/tier_schema'),
    mem_indexes: [{
        name: 'tiers_by_name',
        context: 'system',
        key: 'name'
    }],
    db_indexes: [{
        fields: {
            system: 1,
            name: 1,
            deleted: 1
        },
        options: {
            unique: true,
        }
    }],
}, {
    name: 'pools',
    schema: require('./schemas/pool_schema'),
    mem_indexes: [{
        name: 'pools_by_name',
        context: 'system',
        key: 'name'
    }],
    db_indexes: [{
        fields: {
            system: 1,
            name: 1,
            deleted: 1
        },
        options: {
            unique: true,
        }
    }],
}];

const COLLECTIONS_BY_NAME = _.keyBy(COLLECTIONS, 'name');

let accounts_by_email_lowercase = [];


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
        return id ? this.idmap[String(id)] : null;
    }

    //Return the mongo record (if found) and an indication if the
    //object is linkable (not deleted) -> used in the activity log to link the
    //various entities
    get_by_id_include_deleted(id, name) {
        const res = this.get_by_id(id);
        if (res) {
            return {
                record: res,
                linkable: true
            };
        }
        //Query deleted !== null
        const collection = mongo_client.instance().collection(name);
        return P.resolve(collection.findOne({
                _id: id,
                deleted: {
                    $ne: null
                }
            }))
            .then(res => {
                if (res) {
                    return {
                        record: res,
                        linkable: false
                    };
                } else {
                    return;
                }
            });
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
        this.rebuild_accounts_by_email_lowercase();
    }

    rebuild_idmap() {
        this.idmap = {};
        _.each(COLLECTIONS, col => {
            let items = this[col.name];
            _.each(items, item => {
                let idstr = String(item._id);
                let existing = this.idmap[idstr];
                if (existing) {
                    dbg.error('SystemStoreData: id collision', item, existing);
                } else {
                    this.idmap[idstr] = item;
                }
            });
        });
    }

    rebuild_object_links() {
        _.each(COLLECTIONS, col => {
            let items = this[col.name];
            _.each(items, item => this.resolve_object_ids_recursive(item));
        });
    }

    rebuild_indexes() {
        _.each(COLLECTIONS, col => {
            _.each(col.mem_indexes, index => {
                _.each(this[col.name], item => {
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

    rebuild_accounts_by_email_lowercase() {
        _.each(this.accounts, account => {
            accounts_by_email_lowercase[account.email.toLowerCase()] = account.email;
        });
    }

    check_indexes(col, item) {
        _.each(col.mem_indexes, index => {
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
        this.is_cluster_master = false;
        this.is_finished_initial_load = false;
        this.START_REFRESH_THRESHOLD = 10 * 60 * 1000;
        this.FORCE_REFRESH_THRESHOLD = 60 * 60 * 1000;
        for (const col of COLLECTIONS) {
            mongo_client.instance().define_collection(col);
        }
        js_utils.deep_freeze(COLLECTIONS);
        js_utils.deep_freeze(COLLECTIONS_BY_NAME);
        this.refresh_middleware = () => this.refresh();
        this.initial_load();
    }

    initial_load() {
        mongo_client.instance().on('reconnect', () => this.load());
        P.delay(100)
            .then(() => {
                if (mongo_client.instance().is_connected()) {
                    return this.load();
                }
            })
            .catch(_.noop);
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
                this.load().catch(_.noop);
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
        this._load_promise = P.resolve()
            .then(() => this._register_for_changes())
            .then(() => this._read_data_from_db(new_data))
            .then(() => os_utils.read_server_secret())
            .then(secret => {
                this._server_secret = secret;
                dbg.log1('SystemStore: fetch took', time_utils.millitook(millistamp));
                dbg.log1('SystemStore: fetch size', size_utils.human_size(JSON.stringify(new_data).length));
                dbg.log1('SystemStore: fetch data', util.inspect(new_data, {
                    depth: 4
                }));
                millistamp = time_utils.millistamp();
                new_data.rebuild();
                dbg.log0('SystemStore: rebuild took', time_utils.millitook(millistamp));
                this.data = new_data;
                this.emit('load');
                this.is_finished_initial_load = true;
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
            this.load().catch(_.noop);
        }
    }

    _read_data_from_db(target) {
        let non_deleted_query = {
            deleted: null
        };
        return P.map(COLLECTIONS,
            col => mongo_client.instance().collection(col.name)
            .find(non_deleted_query)
            .toArray()
            .then(res => {
                for (const item of res) {
                    this._check_schema(col, item, 'warn');
                }
                target[col.name] = res;
            })
        );
    }

    _check_schema(col, item, warn) {
        return mongo_client.instance().validate(col.name, item, warn);
    }

    generate_id() {
        return new mongodb.ObjectId();
    }

    make_system_id(id_str) {
        return new mongodb.ObjectId(id_str);
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
            depth: 5
        }));

        let get_collection = name => {
            const col = COLLECTIONS_BY_NAME[name];
            if (!col) {
                throw new Error('SystemStore: make_changes bad collection name - ' + name);
            }
            return col;
        };
        let get_bulk = name => {
            let bulk =
                bulk_per_collection[name] =
                bulk_per_collection[name] ||
                mongo_client.instance().collection(name)
                .initializeUnorderedBulkOp();
            return bulk;
        };

        return P.resolve(this.refresh())
            .then(data => {

                _.each(changes.insert, (list, name) => {
                    const col = get_collection(name);
                    _.each(list, item => {
                        this._check_schema(col, item);
                        data.check_indexes(col, item);
                        get_bulk(name).insert(item);
                    });
                });
                _.each(changes.update, (list, name) => {
                    const col = get_collection(name);
                    _.each(list, item => {
                        data.check_indexes(col, item);
                        let updates = _.omit(item, '_id');
                        let keys = _.keys(updates);

                        if (_.first(keys)[0] === '$') {
                            for (const key of keys) {
                                // Validate that all update keys are mongo operators.
                                if (!mongo_utils.mongo_operators.has(key)) {
                                    throw new Error(`SystemStore: make_changes invalid mix of operators and bare value: ${key}`);
                                }

                                // Delete operators with empty value to comply with
                                // mongo specification.
                                if (_.isEmpty(updates[key])) {
                                    delete updates[key];
                                }
                            }
                        } else {
                            updates = {
                                $set: updates
                            };
                        }

                        // TODO how to _check_schema on update?
                        // if (updates.$set) {
                        //     this._check_schema(col, updates.$set, 'warn');
                        // }
                        get_bulk(name).find({
                                _id: item._id
                            })
                            .updateOne(updates);
                    });
                });
                _.each(changes.remove, (list, name) => {
                    get_collection(name);
                    _.each(list, id => {
                        get_bulk(name).find({
                                _id: id
                            })
                            .updateOne({
                                $set: {
                                    deleted: now
                                }
                            });
                    });
                });

                return P.all(_.map(bulk_per_collection,
                    bulk => bulk.length && P.resolve(bulk.execute())));
            })
            .then(() =>
                // notify all the cluster (including myself) to reload
                server_rpc.client.redirector.publish_to_cluster({
                    method_api: 'server_inter_process_api',
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

    get_local_cluster_info(get_hb) {
        let owner_secret = this.get_server_secret();
        let reply;
        _.each(this.data && this.data.clusters, function(cluster_info) {
            if (cluster_info.owner_secret === owner_secret) {
                reply = get_hb ? cluster_info : _.omit(cluster_info, ['heartbeat']);
            }
        });
        return reply;
    }

    get_server_secret() {
        return this._server_secret;
    }

    get_account_by_email(email) {
        if (this.data && !_.isEmpty(this.data.accounts)) {
            return this.data.accounts_by_email[accounts_by_email_lowercase[email.toLowerCase()]];
        }
    }

}


// EXPORTS
exports.SystemStore = SystemStore;
exports.get_instance = SystemStore.get_instance;
