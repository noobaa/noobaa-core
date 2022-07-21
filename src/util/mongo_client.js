/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const { default: Ajv } = require('ajv');
const util = require('util');
const mongodb = require('mongodb');
const EventEmitter = require('events').EventEmitter;

const P = require('./promise');
const dbg = require('./debug_module')(__filename);
const config = require('../../config.js');
const js_utils = require('./js_utils');
const common_api = require('../api/common_api');
const db_client = require('./db_client');
const schema_utils = require('./schema_utils');
const schema_keywords = require('./schema_keywords');
const { RpcError } = require('../rpc');

mongodb.Binary.prototype[util.inspect.custom] = function custom_inspect_binary() {
    return `<mongodb.Binary ${this.buffer.toString('base64')} >`;
};

class MongoCollection {

    /**
     * @param {MongoCollection} col
     * @returns {nb.DBCollection}
     */
    static implements_interface(col) { return col; }

    constructor(col, mongo_client) {
        MongoCollection.implements_interface(this);
        this.schema = col.schema;
        this.name = col.name;
        this.db_indexes = col.db_indexes;
        this.mongo_client = mongo_client;

    }

    /**
     * @returns { mongodb.Collection }
     */
    _get_mongo_col() {
        return this.mongo_client.db().collection(this.name);
    }

    /**
     * 
     * @param {object} doc 
     * @param {'warn'} [warn] 
     */
    validate(doc, warn) {
        if (this.schema) {
            return this.mongo_client.validate(this.name, doc, warn);
        }
    }

    async find(query, options = {}) { return this._get_mongo_col().find(query, options).toArray(); }
    async findOne(query, options = {}) { return this._get_mongo_col().findOne(query, options); }
    async findOneAndUpdate(query, update, options = {}) { return this._get_mongo_col().findOneAndUpdate(query, update, options); }
    async deleteOne(query, options = {}) { return this._get_mongo_col().deleteOne(query, options); }
    async deleteMany(query, options = {}) { return this._get_mongo_col().deleteMany(query, options); }
    async insertOne(doc, options = {}) { return this._get_mongo_col().insertOne(doc, options); }
    async insertManyUnordered(docs) { return this._get_mongo_col().insertMany(docs, { ordered: false }); }
    async updateOne(query, update, options = {}) { return this._get_mongo_col().updateOne(query, update, options); }
    async updateMany(query, update, options = {}) { return this._get_mongo_col().updateMany(query, update, options); }
    async mapReduce(map, reduce, options = {}) { return this._get_mongo_col().mapReduce(map, reduce, options); }
    async groupBy(match, group) { return this._get_mongo_col().aggregate([{ $match: match }, { $group: group }]).toArray(); }
    async distinct(key, query, options = {}) { return this._get_mongo_col().distinct(key, query, options); }
    initializeUnorderedBulkOp() { return this._get_mongo_col().initializeUnorderedBulkOp(); }
    initializeOrderedBulkOp() { return this._get_mongo_col().initializeOrderedBulkOp(); }
    async countDocuments(query, options = {}) { return this._get_mongo_col().countDocuments(query, options); }
    async estimatedDocumentCount(options = {}) { return this._get_mongo_col().estimatedDocumentCount(options); }
    async estimatedQueryCount(query) { return this._get_mongo_col().countDocuments(query); }
    async stats() { return this._get_mongo_col().stats(); }
}

class MongoSequence {
    constructor(col) {
        this._collection = col.client.define_collection(col);
    }

    async nextsequence() {
        // empty query, we maintain a single doc in this collection
        const query = {};
        const update = { $inc: { object_version_seq: 1 } };
        const options = { upsert: true, returnOriginal: false };
        let res = await this._collection.findOneAndUpdate(query, update, options);
        return res.value.object_version_seq;
    }
}

class MongoClient extends EventEmitter {

    /**
     * @param {MongoClient} client
     * @returns {nb.DBClient}
     */
    static implements_interface(client) { return client; }

    constructor() {
        super();
        MongoClient.implements_interface(this);
        this.mongo_client = null; //Change in mongodb 3.X required operating on the client instead of DBs
        this.should_ignore_connect_timeout = false;
        this.collections = {};
        this.gridfs_buckets = [];
        this.gridfs_instances = {};
        this.connect_timeout = null; //will be set if connected and conn closed
        this.url =
            process.env.MONGO_RS_URL ||
            process.env.MONGODB_URL ||
            process.env.MONGOHQ_URL ||
            process.env.MONGOLAB_URI ||
            'mongodb://localhost/nbcore';
        this.cfg_url =
            'mongodb://localhost:' + config.MONGO_DEFAULTS.CFG_PORT + '/config0';
        this.config = {
            // promoteBuffers makes the driver directly expose node.js Buffer's for bson binary fields
            // instead of mongodb.Binary, which is just a skinny buffer wrapper class.
            // I opened this issue: https://jira.mongodb.org/browse/NODE-1168
            // And suggested this PR: https://github.com/mongodb/node-mongodb-native/pull/1555
            // promoteBuffers: true, // Promotes Binary BSON values to native Node Buffers

            // server:
            // setup infinit retries to connect
            reconnectTries: -1,
            reconnectInterval: 1000,
            autoReconnect: true,
            // bufferMaxEntries=0 is required for autoReconnect
            // see: http://mongodb.github.io/node-mongodb-native/2.0/tutorials/connection_failures/
            bufferMaxEntries: 0,

            // replset
            keepAlive: true,
            connectTimeoutMS: 30000,
            socketTimeoutMS: 0,

            // http://mongodb.github.io/node-mongodb-native/2.0/api/Db.html
            ignoreUndefined: true,

            // authSource defined on which db the auth credentials are verified.
            // when running mongod instance with --auth, the first and only
            // user we can create is on the admin db.
            // since we do not need to manage multiple users we simply use
            // this user to authenticate also to our db.
            //authSource: 'admin',
        };

        this._ajv = new Ajv({ verbose: true, allErrors: true });
        this._ajv.addKeyword(schema_keywords.KEYWORDS.methods);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.doc);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.date);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.idate);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.objectid);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.binary);
        this._ajv.addKeyword(schema_keywords.KEYWORDS.wrapper);
        this._ajv.addSchema(common_api);

        if (process.env.MONGO_RS_URL) {
            this._update_config_for_replset();
        }

        /* exported constants */
        this.operators = new Set([
            '$inc',
            '$mul',
            '$rename',
            '$setOnInsert',
            '$set',
            '$unset',
            '$min',
            '$max',
            '$currentDate',
            '$addToSet',
            '$pop',
            '$pullAll',
            '$pull',
            '$pushAll',
            '$push',
            '$each',
            '$slice',
            '$sort',
            '$position',
            '$bit',
            '$isolated'
        ]);
    }

    /*
     *@param base - the array to subtract from
     *@param values - array of values to subtract from base
     *@out - return an array of string containing values in base which did no appear in values
     */
    obj_ids_difference(base, values) {
        const map_base = {};
        for (let i = 0; i < base.length; ++i) {
            map_base[base[i]] = base[i];
        }
        for (let i = 0; i < values.length; ++i) {
            delete map_base[values[i]];
        }
        return _.values(map_base);
    }

    /**
     * make a list of ObjectId unique by indexing their string value
     * this is needed since ObjectId is an object so === comparison is not
     * logically correct for it even for two objects with the same id.
     */
    uniq_ids(docs, doc_path) {
        const map = {};
        _.each(docs, doc => {
            let id = _.get(doc, doc_path);
            if (id) {
                id = id._id || id;
                map[String(id)] = id;
            }
        });
        return _.values(map);
    }

    /**
     * populate a certain doc path which contains object ids to another collection
     * @template {{}} T
     * @param {T[]} docs
     * @param {string} doc_path
     * @param {nb.DBCollection} collection
     * @param {Object} [fields]
     * @returns {Promise<T[]>}
     */
    async populate(docs, doc_path, collection, fields) {
        const docs_list = _.isArray(docs) ? docs : [docs];
        const ids = this.uniq_ids(docs_list, doc_path);
        if (!ids.length) return docs;
        const items = await collection.find({ _id: { $in: ids } }, { projection: fields });
        const idmap = _.keyBy(items, '_id');
        _.each(docs_list, doc => {
            const id = _.get(doc, doc_path);
            if (id) {
                const item = idmap[String(id)];
                _.set(doc, doc_path, item);
            }
        });
        return docs;
    }


    resolve_object_ids_recursive(idmap, item) {
        _.each(item, (val, key) => {
            if (val instanceof mongodb.ObjectId) {
                if (key !== '_id') {
                    const obj = idmap[val.toHexString()];
                    if (obj) {
                        item[key] = obj;
                    }
                }
            } else if (_.isObject(val) && !_.isString(val)) {
                this.resolve_object_ids_recursive(idmap, val);
            }
        });
        return item;
    }

    resolve_object_ids_paths(idmap, item, paths, allow_missing) {
        _.each(paths, path => {
            const ref = _.get(item, path);
            if (this.is_object_id(ref)) {
                const obj = idmap[ref];
                if (obj) {
                    _.set(item, path, obj);
                } else if (!allow_missing) {
                    throw new Error('resolve_object_ids_paths missing ref to ' +
                        path + ' - ' + ref + ' from item ' + util.inspect(item));
                }
            } else if (!allow_missing) {
                if (!ref || !this.is_object_id(ref._id)) {
                    throw new Error('resolve_object_ids_paths missing ref id to ' +
                        path + ' - ' + ref + ' from item ' + util.inspect(item));
                }
            }
        });
        return item;
    }

    /**
     * @returns {nb.ID}
     */
    new_object_id() {
        return new mongodb.ObjectId();
    }

    /**
     * @param {string} id_str
     * @returns {nb.ID}
     */
    parse_object_id(id_str) {
        if (!id_str) throw new TypeError('parse_object_id: arg required ' + id_str);
        return new mongodb.ObjectId(String(id_str));
    }

    fix_id_type(doc) {
        if (_.isArray(doc)) {
            _.each(doc, d => this.fix_id_type(d));
        } else if (doc && doc._id) {
            doc._id = new mongodb.ObjectId(doc._id);
        }
        return doc;
    }

    is_object_id(id) {
        return (id instanceof mongodb.ObjectId);
    }

    is_err_duplicate_key(err) {
        return err && err.code === 11000;
    }

    is_err_namespace_exists(err) {
        return err && err.code === 48;
    }

    check_duplicate_key_conflict(err, entity) {
        if (this.is_err_duplicate_key(err)) {
            throw new RpcError('CONFLICT', entity + ' already exists');
        } else {
            throw err;
        }
    }

    check_entity_not_found(doc, entity) {
        if (doc) {
            return doc;
        }
        throw new RpcError('NO_SUCH_' + entity.toUpperCase());
    }

    check_entity_not_deleted(doc, entity) {
        if (doc && !doc.deleted) {
            return doc;
        }
        throw new RpcError('NO_SUCH_' + entity.toUpperCase());
    }

    check_update_one(res, entity) {
        // note that res.modifiedCount might be 0 if the update is to same values
        // so we only verify here that the query actually matched a single document.
        if (!res || res.matchedCount !== 1) {
            throw new RpcError('NO_SUCH_' + entity.toUpperCase());
        }
    }

    make_object_diff(current, prev) {
        const set_map = _.pickBy(current, (value, key) => !_.isEqual(value, prev[key]));
        const unset_map = _.pickBy(prev, (value, key) => !(key in current));
        const diff = {};
        if (!_.isEmpty(set_map)) diff.$set = set_map;
        if (!_.isEmpty(unset_map)) diff.$unset = _.mapValues(unset_map, () => 1);
        return diff;
    }

    async get_db_stats() {
        if (!this.promise) {
            throw new Error('get_db_stats: client is not connected');
        }

        // Wait for the client to connect.
        await this.promise;

        // return the stats.
        return this.db().command({ dbStats: 1 });
    }

    /**
     * @returns {MongoClient}
     */
    static instance() {
        if (!MongoClient._instance) MongoClient._instance = new MongoClient();
        return MongoClient._instance;
    }

    set_url(url) {
        if (this.mongo_client || this.promise) {
            throw new Error('trying to set url after already connected...' +
                ' late for the party? ' + url +
                ' existing url ' + this.url);
        }
        this.url = url;
    }

    /**
     * connect and return the db instance which will handle reconnections.
     * mongodb_url is optional and by default takes from env or local db.
     * connect to the "real" mongodb and not the config mongo
     */
    async connect(skip_init_db) {
        this._disconnected_state = false;
        if (this.promise) return this.promise;
        dbg.log0('connect called, current url', this.url);
        this.promise = this._connect(skip_init_db);
        return this.promise;
    }

    async _connect(skip_init_db) {
        let client;
        try {
            if (this._disconnected_state) return;
            if (this.mongo_client) return this.mongo_client.db();
            dbg.log0('_connect: called with', this.url);
            this._set_connect_timeout();
            client = await mongodb.MongoClient.connect(this.url, this.config);
            if (skip_init_db !== 'skip_init_db') {
                await this._init_collections(client.db());
            }
            dbg.log0('_connect: connected', this.url);
            this._reset_connect_timeout();
            this.mongo_client = client;
            this.gridfs_instances = {};
            // for now just print the topologyDescriptionChanged. we'll see if it's worth using later
            this.mongo_client.db().topology.on('topologyDescriptionChanged', function(event) {
                console.log('received topologyDescriptionChanged', util.inspect(event));
            });
            this.mongo_client.db().on('reconnect', () => {
                dbg.log('got reconnect', this.url);
                this.emit('reconnect');
                this._reset_connect_timeout();
            });
            this.mongo_client.db().on('close', () => {
                dbg.warn('got close', this.url);
                this.emit('close');
                this._set_connect_timeout();
            });
            this.emit('reconnect');
            dbg.log0(`connected`);
            return this.mongo_client.db();
        } catch (err) {
            // autoReconnect only works once initial connection is created,
            // so we need to handle retry in initial connect.
            dbg.error('_connect: initial connect failed, will retry', err.stack);
            if (client) {
                client.close();
                client = null;
                this.mongo_client = null;
            }
            await P.delay(config.MONGO_DEFAULTS.CONNECT_RETRY_INTERVAL);
            return this._connect(skip_init_db);
        }
    }

    async _init_collections(db) {
        try {
            await Promise.all(Object.values(this.collections).map(async col => this._init_collection(db, col)));
            await Promise.all(Object.values(this.collections).map(async col => {
                const res = await db.collection(col.name).indexes();
                dbg.log0('_init_collections: indexes of', col.name, _.map(res, 'name'));
            }));
            dbg.log0('_init_collections: done');
        } catch (err) {
            dbg.warn('_init_collections: FAILED', err);
            throw err;
        }
    }

    async _init_collection(db, col) {
        try {
            await db.createCollection(col.name);
        } catch (err) {
            if (!db_client.instance().is_err_namespace_exists(err)) throw err;
        }
        dbg.log0('_init_collection: created collection', col.name);
        if (col.db_indexes) {
            try {
                await Promise.all(col.db_indexes.map(async index => {
                    // skip postgres indexes
                    if (index.postgres) return;
                    try {
                        const res = await db.collection(col.name).createIndex(index.fields, _.extend({ background: true }, index.options));
                        dbg.log0('_init_collection: created index', col.name, res);
                    } catch (err) {
                        if (err.codeName !== 'IndexOptionsConflict') throw err;
                        await db.collection(col.name).dropIndex(index.fields);
                        const res = await db.collection(col.name).createIndex(index.fields, _.extend({ background: true }, index.options));
                        dbg.log0('_init_collection: re-created index with new options', col.name, res);
                    }
                }));
            } catch (err) {
                dbg.error('_init_collection: FAILED', col.name, err);
                throw err;
            }
        }
    }

    async is_collection_indexes_ready(name, indexes) {

        // This checks if the needed indexes exist on the collection
        // Note: we only check for the existence of named indexes
        const existing_indexes = _.keyBy(await this.db().collection(name).indexes(), 'name');
        for (const index of indexes) {
            if (index.name && !existing_indexes[index.name]) return false;
        }

        // Checks if there is a current background operation that creates indexes on collection name
        const current_op = await this.db().admin().command({ currentOp: 1 });
        for (const op of current_op.inprog) {
            if (op.command &&
                op.command.createIndexes === name &&
                op.command.indexes.length) {
                return false;
            }
        }
        return true;
    }

    async dropDatabase() {
        await this.connect('skip_init_db');
        return this.db().dropDatabase();
    }
    async createDatabase() {
        // _.noop();
    }

    async disconnect() {
        dbg.log0('disconnect called');
        this._disconnected_state = true;
        this.promise = null;
        this.gridfs_instances = {};
        if (this.mongo_client) {
            this.mongo_client.close();
            this.mongo_client = null;
        }
    }

    async reconnect() {
        dbg.log0(`reconnect called`);
        this.disconnect();
        return this.connect();
    }

    set_db_name(name) {
        if (this.is_connected()) throw new Error('Cannot set DB name to connected DB');
        this.url = `mongodb://localhost/${name}`;
    }

    get_db_name(name) {
        return this.url.split('/')[3];
    }

    is_connected() {
        return Boolean(this.mongo_client);
    }

    /**
     * 
     * @returns {nb.DBCollection}
     */
    define_collection(col) {
        if (this.collections[col.name]) {
            throw new Error('define_collection: collection already defined ' + col.name);
        }
        if (col.schema) {
            schema_utils.strictify(col.schema, {
                additionalProperties: false
            });
            this._ajv.addSchema(col.schema, col.name);
        }

        const mongo_collection = new MongoCollection(col, this);
        this.collections[col.name] = mongo_collection;
        if (this.mongo_client) {
            this._init_collection(this.mongo_client.db(), mongo_collection).catch(_.noop); // TODO what is best to do when init_collection fails here?
        }
        return mongo_collection;
    }

    define_sequence(params) {
        return new MongoSequence({ ...params, client: this });
    }

    db() {
        if (!this.mongo_client) throw new Error('mongo_client not connected');
        return this.mongo_client.db();
    }

    /**
     * 
     * @returns {nb.DBCollection}
     */
    collection(col_name) {
        if (!this.mongo_client) throw new Error(`mongo_client not connected (collection ${col_name})`);
        return this.collections[col_name];
    }

    define_gridfs(bucket) {
        if (_.find(this.gridfs_buckets, b => b.name === bucket.name)) {
            throw new Error('define_gridfs: gridfs bucket already defined ' + bucket.name);
        }
        bucket.gridfs = () => {
            if (!this.mongo_client) throw new Error(`mongo_client not connected (gridfs name ${bucket.name})`);
            if (!this.gridfs_instances[bucket.name]) {
                this.gridfs_instances[bucket.name] = new mongodb.GridFSBucket(this.mongo_client.db(), {
                    bucketName: bucket.name,
                    chunkSizeBytes: bucket.chunk_size
                });
            }
            return this.gridfs_instances[bucket.name];
        };
        js_utils.deep_freeze(bucket);
        this.gridfs_buckets.push(bucket);

        return bucket;
    }

    validate(col_name, doc, warn) {
        const validator = this._ajv.getSchema(col_name);
        if (!validator(doc)) {
            const msg = `INVALID_SCHEMA_DB ${col_name}`;
            if (warn === 'warn') {
                dbg.warn(msg,
                    'ERRORS', util.inspect(validator.errors, true, null, true),
                    'DOC', util.inspect(doc, true, null, true));
            } else {
                dbg.error(msg,
                    'ERRORS', util.inspect(validator.errors, true, null, true),
                    'DOC', util.inspect(doc, true, null, true));
                throw new Error(msg);
            }
        }
        return doc;
    }

    initiate_replica_set(set, members, is_config_set) {
        var port = is_config_set ? config.MONGO_DEFAULTS.CFG_PORT : config.MONGO_DEFAULTS.SHARD_SRV_PORT;
        var rep_config = this._build_replica_config(set, members, port, is_config_set);
        var command = {
            replSetInitiate: rep_config
        };
        dbg.log0('Calling initiate_replica_set', util.inspect(command, false, null));
        if (!is_config_set) { //connect the mongod server
            return P.resolve(this.mongo_client.db().admin().command(command))
                .catch(err => {
                    dbg.error('Failed initiate_replica_set', set, members, 'with', err.message);
                    throw err;
                });
        }
    }

    replica_update_members(set, members, is_config_set) {
        var port = is_config_set ? config.MONGO_DEFAULTS.CFG_PORT : config.MONGO_DEFAULTS.SHARD_SRV_PORT;
        var rep_config = this._build_replica_config(set, members, port, is_config_set);

        var command = {
            replSetReconfig: rep_config
        };
        return P.resolve(this.get_rs_version(is_config_set))
            .then(ver => {
                ver += 1;
                rep_config.version = ver;
                dbg.log0('Calling replica_update_members', util.inspect(command, false, null));
                if (is_config_set) {
                    //connect the server running the config replica set
                    return P.resolve(this._send_command_config_rs(command));
                } else {
                    //connect the mongod server
                    return P.resolve(this.mongo_client.db().admin().command(command))
                        .catch(err => {
                            dbg.error('Failed replica_update_members', set, members, 'with', err.message);
                            throw err;
                        });
                }
            });
    }

    add_shard(host, port, shardname) {
        dbg.log0('Calling add_shard', shardname, host + ':' + port);

        this.disconnect();
        return P.resolve(this.connect())
            .then(() => {
                dbg.log0('add_shard connected, calling db.admin addShard{}');
                return P.resolve(this.mongo_client.db().admin().command({
                    addShard: host + ':' + port,
                    name: shardname
                }));
            })
            .catch(err => {
                dbg.error('Failed add_shard', host + ':' + port, shardname, 'with', err.message);
                throw err;
            });
    }

    update_connection_string() {
        //TODO:: Currently seems for replica set only
        // var rs = process.env.MONGO_REPLICA_SET || '';
        // dbg.log0('got update_connection_string. rs =', rs, 'this.replica_set =', this.replica_set);
        // dbg.log0('setting connection to new url. conection this. replica_set =', this.replica_set);
        // this.replica_set = rs;
        dbg.log0('got update_connection_string. updating url from', this.url, 'to', process.env.MONGO_RS_URL);
        this.url = process.env.MONGO_RS_URL;
        this._update_config_for_replset();
    }

    get_mongo_rs_status(params) {
        if (!this.mongo_client) {
            throw new Error('db is not initialized');
        }
        let options = params || {};

        const is_config_set = options.is_config_set;
        const COMMAND_TIMEOUT = options.timeout || 5000;

        var command = {
            replSetGetStatus: 1
        };

        return P.timeout(COMMAND_TIMEOUT, (async () => {
                if (is_config_set) {
                    return this._send_command_config_rs(command);
                } else {
                    return this.mongo_client.db().admin().command(command);
                }
            })())
            .catch(err => {
                if (err instanceof P.TimeoutError) {
                    dbg.error(`running replSetGetStatus command got TimeoutError`);
                    return this.reconnect()
                        .then(() => {
                            throw err;
                        });
                }
                throw err;
            });
    }

    async get_rs_version(is_config_set) {
        var command = {
            replSetGetConfig: 1
        };
        let res;
        if (is_config_set) { //connect the server running the config replica set
            res = await this._send_command_config_rs(command);
        } else { //connect the mongod server
            try {
                res = await this.mongo_client.db().admin().command(command);
            } catch (err) {
                dbg.error('Failed get_rs_version with', err.message);
                throw err;
            }
        }
        dbg.log0('Recieved replSetConfig', res, 'Returning RS version', res.config.version);
        return res.config.version;
    }

    async get_mongo_db_version() {
        const build_info = await this.mongo_client.db().admin().buildInfo();
        return build_info.version;
    }

    async set_debug_level(level) {
        var command = {
            setParameter: 1,
            logLevel: level
        };

        const res = await this.mongo_client.db().admin().command(command);
        dbg.log0(`Recieved ${res} from setParameter/logLevel command (${level})`);
    }

    async wait_for_all_members(timeout) {
        timeout = timeout || 2 * 60000; // default timeout 2 minutes
        let waiting_exhausted = false;
        try {
            await P.timeout(timeout, (async () => {
                // wait until all replica set members are operational
                if (process.env.MONGO_RS_URL) {
                    let all_members_up = false;
                    // eslint-disable-next-line no-unmodified-loop-condition
                    while (!all_members_up && !waiting_exhausted) {
                        let rs_status;
                        try {
                            rs_status = await this.get_mongo_rs_status();
                            all_members_up = rs_status.members.every(member =>
                                (member.stateStr === 'PRIMARY' || member.stateStr === 'SECONDARY'));
                            if (!all_members_up) throw new Error('not all members are up');
                            // wait 5 seconds before retesting
                        } catch (err) {
                            dbg.warn('waiting for all members to be operational. current status =', util.inspect(rs_status));
                            await P.delay(5000);
                        }
                    }
                }
                // after connected, make sure we can access the db by calling db.stats
                let db_is_down = true;
                // eslint-disable-next-line no-unmodified-loop-condition
                while (db_is_down && !waiting_exhausted) {
                    try {
                        let stats = this.mongo_client && await this.mongo_client.db().stats();
                        db_is_down = _.get(stats, 'ok') !== 1;
                    } catch (err) {
                        dbg.error('db is still down. got error on db.stats():', err.message);

                    }
                    if (db_is_down) await P.delay(2000);
                }
            })());
        } catch (err) {
            waiting_exhausted = true;
            dbg.error('failed waiting for members:', err);
            throw err;
        }

    }

    async step_down_master({ force, duration }) {
        if (!process.env.MONGO_RS_URL) {
            dbg.error('step down called but not in replica set');
            return;
        }
        await this.mongo_client.db().admin().command({
            replSetStepDown: duration,
            force
        });
    }

    async set_feature_version({ version }) {
        const MAX_RETRIES = 10;
        let retries = 0;
        while (retries < MAX_RETRIES) {
            // operation is idempotent. retry on failure
            try {
                await this.mongo_client.db().admin().command({ setFeatureCompatibilityVersion: version });
                return;
            } catch (err) {
                retries += 1;
                if (retries === MAX_RETRIES) {
                    dbg.error(`failed to set feature compatability version to ${version}. aborting after ${MAX_RETRIES} retries`, err);
                    throw err;
                }
                const DELAY = 10 * 1000;
                dbg.error(`failed to set feature compatability version to ${version}. retrying in ${DELAY / 1000} seconds`, err);
                await P.delay(10000);
            }
        }
    }

    async force_mongo_sync_journal() {
        var command = {
            fsync: 1,
            async: false,

        };

        const res = await this.mongo_client.db().admin().command(command);
        dbg.log0(`Recieved ${res} from sforce_mongo_sync_journal command`);
    }

    _update_config_for_replset() {
        let ca;
        let cert;
        try {
            // for now we read sync since _update_ssl_options is called synchronously. need to be fixed
            ca = [fs.readFileSync(config.MONGO_DEFAULTS.ROOT_CA_PATH)];
            cert = [fs.readFileSync(config.MONGO_DEFAULTS.CLIENT_CERT_PATH)];
        } catch (err) {
            dbg.error('got error when reading mongo certificates:', err);
        }

        this.config.ssl = true;
        this.config.sslValidate = false;
        this.config.checkServerIdentity = false;
        this.config.sslCA = ca;
        this.config.sslCert = cert;
        this.config.sslKey = cert;

        // set mojority write concern
        this.config.w = 'majority';

    }

    _build_replica_config(set, members, port, is_config_set) {
        var rep_config = {
            _id: set,
            configsvr: (_.isUndefined(is_config_set)) ? false : is_config_set,
            members: []
        };
        var id = 0;
        _.each(members, function(m) {
            rep_config.members.push({
                _id: id,
                host: m + ':' + port,
            });
            id += 1;
        });
        return rep_config;
    }

    _send_command_config_rs(command) {
        let cfg_client;
        return P.resolve()
            .then(() => mongodb.MongoClient.connect(this.cfg_url, this.config))
            .catch(err => {
                dbg.error('connecting to config rs failed', err.message);
                throw err;
            })
            .then(client_db => {
                cfg_client = client_db;
            })
            .then(() => cfg_client.db().admin().command(command))
            .then(res => {
                dbg.log0('successfully sent command to config rs', util.inspect(command));
                return res;
            })
            .catch(err => {
                dbg.error('sending command config rs failed', util.inspect(command), err);
                throw err;
            })
            .finally(() => {
                if (cfg_client) {
                    cfg_client.close();
                    cfg_client = null;
                }
            });
    }

    _set_connect_timeout() {
        if (!this.connect_timeout && !this.should_ignore_connect_timeout) {
            this.connect_timeout = setTimeout(() => {
                dbg.error('Connection closed for more ', config.MONGO_DEFAULTS.CONNECT_MAX_WAIT,
                    ', quitting');
                process.exit(1);
            }, config.MONGO_DEFAULTS.CONNECT_MAX_WAIT);
            this.connect_timeout.unref();
        }
    }

    ignore_connect_timeout() {
        this._reset_connect_timeout();
        this.should_ignore_connect_timeout = true;
    }

    _reset_connect_timeout() {
        clearTimeout(this.connect_timeout);
        this.connect_timeout = null;
    }

}

MongoClient._instance = undefined;

// EXPORTS
exports.MongoClient = MongoClient;
exports.MongoSequence = MongoSequence;
exports.instance = MongoClient.instance;
