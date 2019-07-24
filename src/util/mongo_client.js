/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const fs = require('fs');
const Ajv = require('ajv');
const util = require('util');
const mongodb = require('mongodb');
const EventEmitter = require('events').EventEmitter;

const P = require('./promise');
const dbg = require('./debug_module')(__filename);
const config = require('../../config.js');
const js_utils = require('./js_utils');
const common_api = require('../api/common_api');
const mongo_utils = require('./mongo_utils');
const schema_utils = require('./schema_utils');


class MongoClient extends EventEmitter {

    constructor() {
        super();
        this.mongo_client = null; //Change in mongodb 3.X required operating on the client instead of DBs
        this.should_ignore_connect_timeout = false;
        this.collections = [];
        this.gridfs_buckets = [];
        this.gridfs_instances = {};
        this.connect_timeout = null; //will be set if connected and conn closed
        this.url =
            process.env.MONGO_RS_URL ||
            process.env.MONGODB_URL ||
            process.env.MONGOHQ_URL ||
            process.env.MONGOLAB_URI ||
            'mongodb://127.0.0.1/nbcore';
        this.cfg_url =
            'mongodb://127.0.0.1:' + config.MONGO_DEFAULTS.CFG_PORT + '/config0';
        this.config = {
            promiseLibrary: P,
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

        this._ajv = new Ajv({ verbose: true, schemaId: 'auto', allErrors: true });
        this._ajv.addKeyword('date', schema_utils.KEYWORDS.date);
        this._ajv.addKeyword('idate', schema_utils.KEYWORDS.idate);
        this._ajv.addKeyword('objectid', schema_utils.KEYWORDS.objectid);
        this._ajv.addKeyword('binary', schema_utils.KEYWORDS.binary);
        this._ajv.addKeyword('wrapper', schema_utils.KEYWORDS.wrapper);
        this._ajv.addSchema(common_api);

        if (process.env.MONGO_RS_URL) {
            this._update_config_for_replset();
        }

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
            dbg.error('_connect: initial connect failed, will retry', err.message);
            if (client) {
                client.close();
                client = null;
                this.mongo_client = null;
            }
            await P.delay(config.MONGO_DEFAULTS.CONNECT_RETRY_INTERVAL);
            return this._connect(skip_init_db);
        }
    }

    _init_collections(db) {
        return P.map(this.collections, col => this._init_collection(db, col))
            .then(() => P.map(this.collections, col => db.collection(col.name).indexes()
                .then(res => dbg.log0('_init_collections: indexes of', col.name, _.map(res, 'name')))
            ))
            .then(() => dbg.log0('_init_collections: done'))
            .catch(err => {
                dbg.warn('_init_collections: FAILED', err);
                throw err;
            });
    }

    _init_collection(db, col) {
        return P.resolve()
            .then(() => db.createCollection(col.name))
            .catch(err => {
                if (!mongo_utils.is_err_namespace_exists(err)) throw err;
            })
            .then(() => dbg.log0('_init_collection: created collection', col.name))
            .then(() => col.db_indexes && P.map(col.db_indexes,
                index => db.collection(col.name).createIndex(index.fields, _.extend({ background: true }, index.options))
                .then(res => dbg.log0('_init_collection: created index', col.name, res))
                .catch(err => {
                    if (err.codeName === 'IndexOptionsConflict') {
                        return db.collection(col.name).dropIndex(index.fields)
                            .then(() => db.collection(col.name).createIndex(index.fields, _.extend({ background: true }, index.options)))
                            .then(res => dbg.log0('_init_collection: re-created index with new options', col.name, res));
                    } else {
                        throw err;
                    }
                })))
            .catch(err => {
                dbg.error('_init_collection: FAILED', col.name, err);
                throw err;
            });
    }

    disconnect() {
        dbg.log0('disconnect called');
        this._disconnected_state = true;
        this.promise = null;
        this.gridfs_instances = {};
        if (this.mongo_client) {
            this.mongo_client.close();
            this.mongo_client = null;
        }
    }

    reconnect() {
        dbg.log0(`reconnect called`);
        this.disconnect();
        return this.connect();
    }

    is_connected() {
        return Boolean(this.mongo_client);
    }

    define_collection(col) {
        if (_.find(this.collections, c => c.name === col.name)) {
            throw new Error('define_collection: collection already defined ' + col.name);
        }
        if (col.schema) {
            schema_utils.strictify(col.schema, {
                additionalProperties: false
            });
            this._ajv.addSchema(col.schema, col.name);
            col.validate = (doc, warn) => this.validate(col.name, doc, warn);
        }
        col.col = () => this.collection(col.name);
        js_utils.deep_freeze(col);
        this.collections.push(col);
        if (this.mongo_client) {
            this._init_collection(this.mongo_client.db(), col).catch(_.noop); // TODO what is best to do when init_collection fails here?
        }
        return col;
    }

    db() {
        if (!this.mongo_client) throw new Error('mongo_client not connected');
        return this.mongo_client.db();
    }

    collection(col_name) {
        if (!this.mongo_client) throw new Error(`mongo_client not connected (collection ${col_name})`);
        return this.mongo_client.db().collection(col_name);
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

        return P.resolve()
            .then(() => {
                if (is_config_set) {
                    return this._send_command_config_rs(command);
                } else {
                    return this.mongo_client.db().admin().command(command);
                }
            })
            .timeout(COMMAND_TIMEOUT)
            .catch(P.TimeoutError, err => {
                dbg.error(`running replSetGetStatus command got TimeoutError`);
                return this.reconnect()
                    .then(() => {
                        throw err;
                    });
            });
    }

    get_rs_version(is_config_set) {
        var command = {
            replSetGetConfig: 1
        };

        return P.fcall(() => {
                if (is_config_set) { //connect the server running the config replica set
                    return P.resolve(this._send_command_config_rs(command));
                } else { //connect the mongod server
                    return P.resolve(this.mongo_client.db().admin().command(command))
                        .catch(err => {
                            dbg.error('Failed get_rs_version with', err.message);
                            throw err;
                        });
                }
            })
            .then(res => {
                dbg.log0('Recieved replSetConfig', res, 'Returning RS version', res.config.version);
                return res.config.version;
            });
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

    async is_master(ip) {
        const is_master_res = await this.mongo_client.db().command({ isMaster: 1 });
        return is_master_res.primary.startsWith(ip);
    }


    async wait_for_all_members(timeout) {
        timeout = timeout || 2 * 60000; // default timeout 2 minutes
        let waiting_exhausted = false;
        try {
            await P.resolve()
                .then(async () => {
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
                })
                .timeout(timeout);
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
exports.instance = MongoClient.instance;
