/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const Ajv = require('ajv');
const util = require('util');
const mongodb = require('mongodb');
const EventEmitter = require('events').EventEmitter;

const P = require('./promise');
const dbg = require('./debug_module')(__filename);
const config = require('../../config.js');
const js_utils = require('./js_utils');
const mongo_utils = require('./mongo_utils');
const schema_utils = require('./schema_utils');

class MongoClient extends EventEmitter {

    constructor() {
        super();
        this.db = null; // will be set once connected
        this.cfg_db = null; // will be set once a part of a cluster & connected
        this.admin_db = null;
        this.collections = [];
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
            server: {
                // setup infinit retries to connect
                reconnectTries: -1,
                reconnectInterval: 1000,
                socketOptions: {
                    autoReconnect: true
                }
            },
            replset: {
                socketOptions: {
                    keepAlive: 1,
                    connectTimeoutMS: 30000,
                    socketTimeoutMS: 0
                }
            },
            db: {
                // bufferMaxEntries=0 is required for autoReconnect
                // see: http://mongodb.github.io/node-mongodb-native/2.0/tutorials/connection_failures/
                bufferMaxEntries: 0,
                // authSource defined on which db the auth credentials are verified.
                // when running mongod instance with --auth, the first and only
                // user we can create is on the admin db.
                // since we do not need to manage multiple users we simply use
                // this user to authenticate also to our db.
                //authSource: 'admin',
            }
        };
        this._json_validator = new Ajv({
            verbose: true,
            formats: mongo_utils.mongo_ajv_formats,
        });
    }

    static instance() {
        if (!MongoClient._instance) MongoClient._instance = new MongoClient();
        return MongoClient._instance;
    }

    set_url(url) {
        if (this.db || this.promise) {
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
    connect() {
        dbg.log0('connect called, current url', this.url);
        this._disconnected_state = false;
        if (this.promise) return this.promise;
        this.promise = P.resolve().then(() => this._connect());
        return this.promise;
    }

    _connect() {
        if (this._disconnected_state) return;
        if (this.db) return this.db;
        let db;
        dbg.log0('_connect: called with', this.url);
        this._set_connect_timeout();
        return mongodb.MongoClient.connect(this.url, this.config)
            .then(db_arg => {
                db = db_arg;
            })
            .then(() => this._init_collections(db))
            .then(() => {
                dbg.log0('_connect: connected', this.url);
                this._reset_connect_timeout();
                this.db = db;
                // for now just print the topologyDescriptionChanged. we'll see if it's worth using later
                db.topology.on('topologyDescriptionChanged', function(event) {
                    console.log('received topologyDescriptionChanged', util.inspect(event));
                });
                db.on('reconnect', () => {
                    dbg.log('got reconnect', this.url);
                    this.emit('reconnect');
                    this._reset_connect_timeout();
                });
                db.on('close', () => {
                    dbg.warn('got close', this.url);
                    this.emit('close');
                    this._set_connect_timeout();
                });
                this.emit('reconnect');
                dbg.log0(`connected`);
                return db;
            }, err => {
                // autoReconnect only works once initial connection is created,
                // so we need to handle retry in initial connect.
                dbg.error('_connect: initial connect failed, will retry', err.message);
                if (db) {
                    db.close();
                    db = null;
                }
                return P.delay(config.MONGO_DEFAULTS.CONNECT_RETRY_INTERVAL)
                    .then(() => this._connect());
            });
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
            ))
            .catch(err => {
                dbg.error('_init_collection: FAILED', col.name, err);
                throw err;
            });
    }

    disconnect() {
        dbg.log0('disconnect called');
        this._disconnected_state = true;
        this.promise = null;
        if (this.db) {
            this.db.close();
            this.db = null;
            this.admin_db = null;
        }
        if (this.cfg_db) {
            this.cfg_db.close();
            this.cfg_db = null;
        }
    }

    reconnect() {
        dbg.log0(`reconnect called`);
        this.disconnect();
        return this.connect();
    }

    is_connected() {
        return Boolean(this.db);
    }

    define_collection(col) {
        if (_.find(this.collections, c => c.name === col.name)) {
            throw new Error('define_collection: collection already defined ' + col.name);
        }
        if (col.schema) {
            schema_utils.strictify(col.schema);
            this._json_validator.addSchema(col.schema, col.name);
            col.validate = (doc, warn) => this.validate(col.name, doc, warn);
        }
        col.col = () => this.collection(col.name);
        js_utils.deep_freeze(col);
        this.collections.push(col);
        if (this.db) {
            this._init_collection(this.db, col).catch(_.noop); // TODO what is best to do when init_collection fails here?
        }
        return col;
    }

    collection(col_name) {
        if (!this.db) throw new Error(`mongo_client not connected (collection ${col_name})`);
        return this.db.collection(col_name);
    }

    validate(col_name, doc, warn) {
        const validator = this._json_validator.getSchema(col_name);
        if (!validator(doc)) {
            const msg = `BAD COLLECTION SCHEMA ${col_name}`;
            if (warn === 'warn') {
                dbg.warn(msg, doc, 'ERRORS', validator.errors);
            } else {
                dbg.error(msg, doc, 'ERRORS', validator.errors);
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
            return P.resolve(this.db.admin().command(command))
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
            .then((ver) => {
                ver += 1;
                rep_config.version = ver;
                dbg.log0('Calling replica_update_members', util.inspect(command, false, null));
                if (!is_config_set) { //connect the mongod server
                    return P.resolve(this.db.admin().command(command))
                        .catch((err) => {
                            dbg.error('Failed replica_update_members', set, members, 'with', err.message);
                            throw err;
                        });
                } else { //connect the server running the config replica set
                    return P.resolve(this._send_command_config_rs(command));
                }
            });
    }

    add_shard(host, port, shardname) {
        dbg.log0('Calling add_shard', shardname, host + ':' + port);

        this.disconnect();
        return P.resolve(this.connect())
            .then(() => {
                dbg.log0('add_shard connected, calling db.admin addShard{}');
                return P.resolve(this.db.admin().command({
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
    }

    get_mongo_rs_status(params) {
        if (!this.db) {
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
                    return this.db.admin().command(command);
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
        var self = this;
        var command = {
            replSetGetConfig: 1
        };

        return P.fcall(function() {
                if (!is_config_set) { //connect the mongod server
                    return P.resolve(self.db.admin().command(command))
                        .catch((err) => {
                            dbg.error('Failed get_rs_version with', err.message);
                            throw err;
                        });
                } else { //connect the server running the config replica set
                    return P.resolve(self._send_command_config_rs(command));
                }
            })
            .then((res) => {
                dbg.log0('Recieved replSetConfig', res, 'Returning RS version', res.config.version);
                return res.config.version;
            });

    }

    _build_replica_config(set, members, port, is_config_set) {
        var rep_config = {
            _id: set,
            configsvr: (!_.isUndefined(is_config_set)) ? is_config_set : false,
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
        let cfg_db;
        return P.resolve()
            .then(() => mongodb.MongoClient.connect(this.cfg_url, this.config))
            .catch(err => {
                dbg.error('connecting to config rs failed', err.message);
                throw err;
            })
            .then(cfg_db_arg => {
                cfg_db = cfg_db_arg;
            })
            .then(() => cfg_db.admin().command(command))
            .then(res => {
                dbg.log0('successfully sent command to config rs', util.inspect(command));
                return res;
            })
            .catch(err => {
                dbg.error('sending command config rs failed', util.inspect(command), err);
                throw err;
            })
            .finally(() => {
                if (cfg_db) {
                    cfg_db.close();
                    cfg_db = null;
                }
            });
    }

    _set_connect_timeout() {
        if (!this.connect_timeout) {
            this.connect_timeout = setTimeout(() => {
                dbg.error('Connection closed for more ', config.MONGO_DEFAULTS.CONNECT_MAX_WAIT,
                    ', quitting');
                process.exit(1);
            }, config.MONGO_DEFAULTS.CONNECT_MAX_WAIT);
        }
    }

    _reset_connect_timeout() {
        clearTimeout(this.connect_timeout);
        this.connect_timeout = null;
    }
}

// EXPORTS
exports.MongoClient = MongoClient;
exports.instance = MongoClient.instance;
