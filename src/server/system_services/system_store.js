/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../../sdk/nb')} nb */

const _ = require('lodash');
const util = require('util');
const EventEmitter = require('events').EventEmitter;
const system_schema = require('./schemas/system_schema');
const cluster_schema = require('./schemas/cluster_schema');
const namespace_resource_schema = require('./schemas/namespace_resource_schema');
const role_schema = require('./schemas/role_schema');
const account_schema = require('./schemas/account_schema');
const bucket_schema = require('./schemas/bucket_schema');
const tiering_policy_schema = require('./schemas/tiering_policy_schema');
const tier_schema = require('./schemas/tier_schema');
const pool_schema = require('./schemas/pool_schema');
const agent_config_schema = require('./schemas/agent_config_schema');
const chunk_config_schema = require('./schemas/chunk_config_schema');
const master_key_schema = require('./schemas/master_key_schema');
const system_indexes = require('./schemas/system_indexes');
const cluster_indexes = require('./schemas/cluster_indexes');
const namespace_resource_indexes = require('./schemas/namespace_resource_indexes');
const account_indexes = require('./schemas/account_indexes');
const bucket_indexes = require('./schemas/bucket_indexes');
const tiering_policy_indexes = require('./schemas/tiering_policy_indexes');
const tier_indexes = require('./schemas/tier_indexes');
const pool_indexes = require('./schemas/pool_indexes');
const agent_config_indexes = require('./schemas/agent_config_indexes');

const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const js_utils = require('../../util/js_utils');
const Semaphore = require('../../util/semaphore');
const server_rpc = require('../server_rpc');
const time_utils = require('../../util/time_utils');
const size_utils = require('../../util/size_utils');
const os_utils = require('../../util/os_utils');
const config = require('../../../config');
const db_client = require('../../util/db_client');

const { RpcError } = require('../../rpc');
const master_key_manager = require('./master_key_manager');

const COLLECTIONS = [{
    name: 'clusters',
    schema: cluster_schema,
    mem_indexes: [{
        name: 'cluster_by_server',
        key: 'owner_secret'
    }],
    db_indexes: cluster_indexes,
}, {
    name: 'namespace_resources',
    schema: namespace_resource_schema,
    mem_indexes: [{
        name: 'namespace_resources_by_name',
        context: 'system',
        key: 'name'
    }],
    db_indexes: namespace_resource_indexes,
}, {
    name: 'systems',
    schema: system_schema,
    mem_indexes: [{
        name: 'systems_by_name',
        key: 'name'
    }],
    db_indexes: system_indexes,
}, {
    name: 'roles',
    schema: role_schema,
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
}, {
    name: 'accounts',
    schema: account_schema,
    mem_indexes: [{
        name: 'accounts_by_email',
        key: 'email'
    }],
    db_indexes: account_indexes,
}, {
    name: 'buckets',
    schema: bucket_schema,
    mem_indexes: [{
        name: 'buckets_by_name',
        context: 'system',
        key: 'name'
    }],
    db_indexes: bucket_indexes,
}, {
    name: 'tieringpolicies',
    schema: tiering_policy_schema,
    mem_indexes: [{
        name: 'tiering_policies_by_name',
        context: 'system',
        key: 'name'
    }],
    db_indexes: tiering_policy_indexes,
}, {
    name: 'tiers',
    schema: tier_schema,
    mem_indexes: [{
        name: 'tiers_by_name',
        context: 'system',
        key: 'name'
    }],
    db_indexes: tier_indexes,
}, {
    name: 'pools',
    schema: pool_schema,
    mem_indexes: [{
        name: 'pools_by_name',
        context: 'system',
        key: 'name'
    }],
    db_indexes: pool_indexes,
}, {
    name: 'agent_configs',
    schema: agent_config_schema,
    db_indexes: agent_config_indexes,
}, {
    name: 'chunk_configs',
    schema: chunk_config_schema,
    mem_indexes: [{
        name: 'chunk_configs_by_id',
        context: 'system',
        key: '_id'
    }],
}, {
    name: 'master_keys',
    schema: master_key_schema,
    mem_indexes: [{
        name: 'master_keys_by_id',
        key: '_id'
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

        // define the properties of collections and mem_indexes for type checks
        this.clusters = undefined;
        this.cluster_by_server = undefined;
        this.namespace_resources = undefined;
        /** @type {nb.System[]} */
        this.systems = undefined;
        /** @type {{ [name: string]: nb.System }} */
        this.systems_by_name = undefined;
        this.roles = undefined;
        /** @type {nb.Account[]} */
        this.accounts = undefined;
        /** @type {{ [email: string]: nb.Account }} */
        this.accounts_by_email = undefined;
        /** @type {nb.Bucket[]} */
        this.buckets = undefined;
        /** @type {nb.Tiering[]} */
        this.tieringpolicies = undefined;
        /** @type {nb.Tier[]} */
        this.tiers = undefined;
        /** @type {nb.Pool[]} */
        this.pools = undefined;
        /** @type {nb.ChunkConfig[]} */
        this.chunk_configs = undefined;
        this.agent_configs = undefined;
        this.master_keys_by_id = undefined;
    }

    /**
     * If id is falsy return undefined, because it should mean there is no entity to resolve.
     * Otherwise lookup the id in the map, and if not found return null to indicate the id is not found.
     * @param {string|nb.ID} id
     */
    get_by_id(id) {
        if (!id) return undefined;
        return this.idmap[String(id)] || null;
    }

    //Return the mongo record (if found) and an indication if the
    //object is linkable (not deleted) -> used in the activity log to link the
    //various entities
    async get_by_id_include_deleted(id, name) {
        const res = this.get_by_id(id);
        if (res) {
            return {
                record: res,
                linkable: true
            };
        }
        //Query deleted !== null
        const collection = db_client.instance().collection(name);
        const find_res = await collection.findOne({
            _id: id,
            deleted: {
                $ne: null
            }
        });
        if (find_res) {
            return {
                record: find_res,
                linkable: false
            };
        }
    }

    resolve_object_ids_paths(item, paths, allow_missing) {
        return db_client.instance().resolve_object_ids_paths(this.idmap, item, paths, allow_missing);
    }

    resolve_object_ids_recursive(item) {
        return db_client.instance().resolve_object_ids_recursive(this.idmap, item);
    }

    rebuild() {
        this.rebuild_idmap();
        this.rebuild_object_links();
        this.rebuild_indexes();
        this.rebuild_accounts_by_email_lowercase();

        // TODO: deep freeze the data once tested enough
        // js_utils.deep_freeze(this);
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
                    const field = _.get(item, index.key || '_id');
                    if (!field) {
                        dbg.error(`SystemStoreData: Item ${col.name}[${item._id}] could not be indexed for ${index.name}
                            (Index field ${index.key} not found on item), skipping`);
                        return;
                    }
                    const key = field.valueOf();
                    let val = index.val ? _.get(item, index.val) : item;
                    let context = index.context ? _.get(item, index.context) : this;
                    let map = context[index.name] || {};
                    context[index.name] = map;
                    if (index.val_array) {
                        map[key] = map[key] || [];
                        map[key].push(val);
                    } else if (key in map) {
                        dbg.error('SystemStoreData:', index.name,
                            'collision on key', key, val._id, map[key]._id);
                    } else {
                        map[key] = val;
                    }
                });
            });
        });
    }

    rebuild_accounts_by_email_lowercase() {
        _.each(this.accounts, account => {
            accounts_by_email_lowercase[account.email.unwrap().toLowerCase()] = account.email.unwrap();
        });
    }


    check_indexes(col, item) {
        _.each(col.mem_indexes, index => {
            let key = _.get(item, index.key || '_id');
            let context = index.context ? _.get(item, index.context) : this;
            if (!context) return;
            let map = context[index.name];
            if (!index.val_array) {
                let existing = map && map[key];
                if (existing && String(existing._id) !== String(item._id)) {
                    throw new RpcError('CONFLICT', index.name + ' collision on key ' + key);
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

    /**
     * @returns {SystemStore}
     */
    static get_instance(options = {}) {
        const { standalone } = options;
        SystemStore._instance = SystemStore._instance || new SystemStore({ standalone });
        return SystemStore._instance;
    }

    constructor(options) {
        super();
        // // TODO: This is currently used as a cache, maybe will be moved in the future
        // this.valid_for_alloc_by_tier = {};
        this.master_key_manager = master_key_manager.get_instance();
        this.last_update_time = config.NOOBAA_EPOCH;
        this.is_standalone = options.standalone;
        this.is_cluster_master = false;
        this.is_finished_initial_load = false;
        this.START_REFRESH_THRESHOLD = 10 * 60 * 1000;
        this.FORCE_REFRESH_THRESHOLD = 60 * 60 * 1000;
        this._load_serial = new Semaphore(1);
        for (const col of COLLECTIONS) {
            db_client.instance().define_collection(col);
        }
        js_utils.deep_freeze(COLLECTIONS);
        js_utils.deep_freeze(COLLECTIONS_BY_NAME);
        this.refresh_middleware = () => this.refresh();
        this.initial_load();
    }

    [util.inspect.custom]() { return 'SystemStore'; }

    initial_load() {
        db_client.instance().on('reconnect', () => this.load());
        P.delay(100)
            .then(() => {
                if (db_client.instance().is_connected()) {
                    return this.load();
                }
            })
            .catch(_.noop);
    }

    clean_system_store() {
        this.old_db_data = undefined;
        this.last_update_time = config.NOOBAA_EPOCH;
    }

    async refresh() {
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
    }

    async load(since) {
        // serializing load requests since we have to run a fresh load after the previous one will finish
        // because it might not see the latest changes if we don't reload right after make_changes.
        return this._load_serial.surround(async () => {
            try {
                dbg.log3('SystemStore: loading ...');

                // If we get a load request with an timestamp older then our last update time
                // we ensure we load everyting from that timestamp by updating our last_update_time.
                if (!_.isUndefined(since) && since < this.last_update_time) {
                    dbg.log0('SystemStore.load: Got load request with a timestamp older then my last update time');
                    this.last_update_time = since;
                }

                await this.master_key_manager.load_root_key();
                let new_data = new SystemStoreData();
                let millistamp = time_utils.millistamp();
                await this._register_for_changes();
                await this._read_new_data_from_db(new_data);
                const secret = await os_utils.read_server_secret();
                this._server_secret = secret;
                dbg.log1('SystemStore: fetch took', time_utils.millitook(millistamp));
                dbg.log1('SystemStore: fetch size', size_utils.human_size(JSON.stringify(new_data).length));
                dbg.log1('SystemStore: fetch data', util.inspect(new_data, {
                    depth: 4
                }));
                this.old_db_data = this._update_data_from_new(this.old_db_data || {}, new_data);
                this.data = _.cloneDeep(this.old_db_data);
                millistamp = time_utils.millistamp();
                this.data.rebuild();
                dbg.log1('SystemStore: rebuild took', time_utils.millitook(millistamp));
                if (this.data.master_keys_by_id) {
                    this.master_key_manager.update_master_keys(this.data.master_keys_by_id);
                    await this.master_key_manager.decrypt_all_accounts_secret_keys({
                        accounts: this.data.accounts,
                        pools: this.data.pools,
                        namespace_resources: this.data.namespace_resources
                    });
                }
                this.emit('load');
                this.is_finished_initial_load = true;
                return this.data;
            } catch (err) {
                dbg.error('SystemStore: load failed', err.stack || err);
                throw err;
            }
        });
    }

    _update_data_from_new(data, new_data) {
        COLLECTIONS.forEach(col => {
            const old_items = data[col.name];
            const new_items = new_data[col.name];
            const u = _.unionBy(new_items, old_items, doc => doc._id.toString());
            new_data[col.name] = u.filter(doc => !doc.deleted);
        });
        return new_data;
    }


    async _register_for_changes() {
        if (this.is_standalone) {
            dbg.log0('system_store is running in standalone mode. skip _register_for_changes');
            return;
        }
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

    async _read_data_from_db(target) {
        let non_deleted_query = {
            deleted: null
        };
        await db_client.instance().connect();
        return P.map(COLLECTIONS, async col => {
            const res = await db_client.instance().collection(col.name).find(non_deleted_query);
            for (const item of res) {
                this._check_schema(col, item, 'warn');
            }
            target[col.name] = res;
        });
    }

    async _read_new_data_from_db(target) {
        const now = Date.now();
        let newly_updated_query = {
            last_update: {
                $gte: this.last_update_time,
            }
        };
        await db_client.instance().connect();
        await P.map(COLLECTIONS, async col => {
            const res = await db_client.instance().collection(col.name)
                .find(newly_updated_query, {
                    projection: { last_update: 0 }
                });
            for (const item of res) {
                this._check_schema(col, item, 'warn');
            }
            target[col.name] = res;
        });
        this.last_update_time = now;
    }

    _check_schema(col, item, warn) {
        return db_client.instance().validate(col.name, item, warn);
    }

    new_system_store_id() {
        return db_client.instance().new_object_id();
    }

    parse_system_store_id(id_str) {
        return db_client.instance().parse_object_id(id_str);
    }

    has_same_id(obj1, obj2) {
        return String(obj1._id) === String(obj2._id);
    }

    async get_system_collections_dump() {
        const dump = {};
        await db_client.instance().connect();
        await P.map(COLLECTIONS, async col => {
            const docs = await db_client.instance().collection(col.name).find();
            for (const doc of docs) {
                this._check_schema(col, doc, 'warn');
            }
            dump[col.name] = docs;
        });
        return dump;
    }

    async make_changes_with_retries(changes, { max_retries = 3, delay = 1000 } = {}) {
        let retries = 0;
        let changes_updated = false;
        while (!changes_updated) {
            try {
                await this.make_changes(changes);
                changes_updated = true;
            } catch (err) {
                if (retries === max_retries) {
                    dbg.error(`make_changes_with_retries failed. aborting after ${max_retries} retries. changes=`,
                        util.inspect(changes, { depth: 5 }),
                        'error=', err);
                    throw err;
                }
                dbg.warn(`make_changes failed. will retry in ${delay / 1000} seconds. changes=`,
                    util.inspect(changes, { depth: 5 }),
                    'error=', err);
                retries += 1;
                await P.delay(delay);
            }
        }
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
     *      buckets: [{ $find: { _id: 543, 'lambda_triggers._id': 567}, $set: {...}}]
     *   },
     *   remove: {
     *      systems: [123, 789],
     *   }
     * })
     *
     * @param {Object} changes
     * @property {Object} [insert]
     * @property {Object} [update]
     * @property {Object} [remove]
     *
     */
    async make_changes(changes) {
        const { any_news, last_update } = await this._load_serial.surround(
            () => this._make_changes_internal(changes)
        );

        // Reloading must be done outside the semapore lock because the load is
        // locking on the same semaphore.
        if (any_news) {
            if (this.is_standalone) {
                await this.load(last_update);
            } else {
                // notify all the cluster (including myself) to reload
                await server_rpc.client.redirector.publish_to_cluster({
                    method_api: 'server_inter_process_api',
                    method_name: 'load_system_store',
                    target: '',
                    request_params: { since: last_update }
                });
            }
        }
    }

    async _make_changes_internal(changes) {
        const bulk_per_collection = {};
        const now = new Date();
        const last_update = now.getTime();
        let any_news = false;
        dbg.log0('SystemStore.make_changes:', util.inspect(changes, {
            depth: 5
        }));

        const get_collection = name => {
            const col = COLLECTIONS_BY_NAME[name];
            if (!col) {
                throw new Error('SystemStore: make_changes bad collection name - ' + name);
            }
            return col;
        };
        const get_bulk = name => {
            const bulk = bulk_per_collection[name] ||
                db_client.instance().collection(name).initializeUnorderedBulkOp();
            bulk_per_collection[name] = bulk;
            return bulk;
        };

        const data = await this.refresh();

        _.each(changes.insert, (list, name) => {
            const col = get_collection(name);
            _.each(list, item => {
                this._check_schema(col, item);
                data.check_indexes(col, item);
                item.last_update = last_update;
                any_news = true;
                get_bulk(name).insert(item);
            });
        });
        _.each(changes.update, (list, name) => {
            const col = get_collection(name);
            _.each(list, item => {
                data.check_indexes(col, item);
                let dont_change_last_update = Boolean(item.dont_change_last_update);
                let updates = _.omit(item, '_id', '$find', 'dont_change_last_update');
                let find_id = _.pick(item, '_id');
                let finds = item.$find || (db_client.instance().is_object_id(find_id._id) && find_id);
                if (_.isEmpty(updates)) return;
                if (!finds) throw new Error(`SystemStore: make_changes id is not of type object_id: ${find_id._id}`);
                let keys = _.keys(updates);

                if (_.first(keys)[0] === '$') {
                    for (const key of keys) {
                        // Validate that all update keys are mongo operators.
                        if (!db_client.instance().operators.has(key)) {
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
                if (!dont_change_last_update) {
                    if (!updates.$set) updates.$set = {};
                    updates.$set.last_update = last_update;
                    any_news = true;
                }
                get_bulk(name).find(finds).updateOne(updates);
                // .findAndUpdateOne(finds, updates);
                // .find(finds)
                // .updateOne(updates);
            });
        });
        _.each(changes.remove, (list, name) => {
            get_collection(name);
            _.each(list, id => {
                if (!db_client.instance().is_object_id(id)) throw new Error(`SystemStore: make_changes id is not of type object_id: ${id}`);
                any_news = true;
                const query = {
                    _id: id
                };
                const update = {
                    $set: {
                        deleted: now,
                        last_update: last_update,
                    }
                };
                get_bulk(name).find(query).updateOne(update);
                // .find({
                //     _id: id
                // })
                // .updateOne({
                //     $set: {
                //         deleted: now,
                //         last_update: last_update,
                //     }
                // });
            });
        });

        _.each(changes.db_delete, (list, name) => {
            get_collection(name);
            _.each(list, id => {
                if (!db_client.instance().is_object_id(id)) throw new Error(`SystemStore: make_changes id is not of type object_id: ${id}`);
                const query = {
                    _id: id,
                    deleted: { $exists: true }
                };
                get_bulk(name).find(query).removeOne();
                //     .find({
                //         _id: id,
                //         deleted: { $exists: true }
                //     })
                //     .removeOne();
            });
        });

        const bulk_results = await Promise.all(Object.values(bulk_per_collection).map(
            bulk => bulk.length && bulk.execute({ j: true })
        ));

        for (const res of bulk_results) {
            if (res && !res.ok) {
                dbg.error('got error on bulk execute', res.err);
                // should we throw here? retry?
            }
        }

        return { any_news, last_update };
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

    /**
     * @param {boolean} [get_hb]
     * @returns {object}
     */
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

    get_account_by_email(email_wrapped) {
        if (this.data && !_.isEmpty(this.data.accounts)) {
            return this.data.accounts_by_email[email_wrapped.unwrap()];
        }
    }

    get_accounts_by_nsfs_account_config(nsfs_account_config) {
        if (this.data && !_.isEmpty(this.data.accounts)) {
            return this.data.accounts.filter(account => account.nsfs_account_config &&
                account.nsfs_account_config.uid === nsfs_account_config.uid &&
                account.nsfs_account_config.gid === nsfs_account_config.gid);
        }
    }

    async find_deleted_docs(name, max_delete_time, limit) {
        const collection = db_client.instance().collection(name);
        const query = {
            deleted: {
                $lt: new Date(max_delete_time)
            },
        };
        const docs = await collection.find(query, {
            limit: Math.min(limit, 1000),
            projection: {
                _id: 1,
                deleted: 1
            }
        });
        return db_client.instance().uniq_ids(docs, '_id');
    }

    async count_total_docs(name) {
        const collection = db_client.instance().collection(name);
        return collection.countDocuments({}); // maybe estimatedDocumentCount()
    }
}

SystemStore._instance = undefined;

// EXPORTS
exports.SystemStore = SystemStore;
exports.get_instance = SystemStore.get_instance;
