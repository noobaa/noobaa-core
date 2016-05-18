'use strict';

var _ = require('lodash');
var util = require('util');
var mongodb = require('mongodb');
var EventEmitter = require('events').EventEmitter;
var P = require('./promise');
var dbg = require('./debug_module')(__filename);
var config = require('../../config.js');

class MongoClient extends EventEmitter {

    static get_instance() {
        MongoClient._client = MongoClient._client || new MongoClient();
        return MongoClient._client;
    }

    constructor() {
        super();
        this.db = null; // will be set once connected
        this.cfg_db = null; // will be set once a part of a cluster & connected
        this.url =
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
            db: {
                // bufferMaxEntries=0 is required for autoReconnect
                // see: http://mongodb.github.io/node-mongodb-native/2.0/tutorials/connection_failures/
                bufferMaxEntries: 0
            }
        };
    }

    set_url(url) {
        if (this.db || this.promise) {
            throw new Error('MongoClient: trying to set url after already connected...' +
                ' late for the party? ' + url +
                ' existing url ' + this.url);
        }
        this.url = url;
    }

    /**
     * connect and return the db instance which will handle reconnections.
     * mongodb_url is optional and by default takes from env or local db.
     */
    connect() {
        dbg.log0('connect called');
        this._disconnected_state = false;
        if (this.promise) return this.promise;
        this.promise = this._connect('db', this.url, this.config);
        return this.promise;
    }

    _connect(access_db, url, config) {
        if (this._disconnected_state) return;
        if (this[access_db]) return this[access_db];
        dbg.log0('_connect called with', url, config);
        return mongodb.MongoClient.connect(url, config)
            .then(db => {
                dbg.log0('MongoClient: connected', url);
                db.on('reconnect', () => {
                    this.emit('reconnect');
                    console.log('MongoClient: got reconnect', url);
                });
                db.on('close', () => {
                    this.emit('close');
                    console.warn('MongoClient: got close', url);
                });
                this[access_db] = db;
                return db;
            }, err => {
                // autoReconnect only works once initial connection is created,
                // so we need to handle retry in initial connect.
                console.error('MongoClient: initial connect failed, will retry', err.message);
                return P.delay(3000).then(() => this._connect(access_db, url, config));
            });
    }

    disconnect() {
        dbg.log0('disconnect called');
        this._disconnected_state = true;
        this.promise = null;
        if (this.db) {
            this.db.close();
            this.db = null;
        }
        if (this.cfg_db) {
            this.cfg_db.close();
            this.cfg_db = null;
        }
    }

    initiate_replica_set(set, members, is_config_set) {
        var port = is_config_set ? config.MONGO_DEFAULTS.CFG_PORT : config.MONGO_DEFAULTS.SHARD_SRV_PORT;
        var rep_config = this._build_replica_config(set, members, port);
        var command = {
            replSetInitiate: rep_config
        };
        dbg.log0('Calling initiate_replica_set', util.inspect(command, false, null));
        if (!is_config_set) { //connect the mongod server
            return P.when(this.db.admin().command(command))
                .fail((err) => {
                    console.error('Failed initiate_replica_set', set, members, 'with', err.message);
                    throw err;
                });
        } else { //connect the server running the config replica set
            return this._send_command_config_rs(command);
        }
    }

    replica_update_members(set, members, is_config_set) {
        var rep_config = this._build_replica_config(set, members);
        var command = {
            replSetReconfig: rep_config
        };
        dbg.log0('Calling replica_update_members', util.inspect(command, false, null));
        if (!is_config_set) { //connect the mongod server
            return P.when(this.db.admin().command(command))
                .fail((err) => {
                    console.error('Failed replica_update_members', set, members, 'with', err.message);
                    throw err;
                });
        } else { //connect the server running the config replica set
            return this._send_command_config_rs(command);
        }
    }

    add_shard(host, port, shardname) {
        dbg.log0('Calling add_shard', shardname, host + ':' + port);

        this.disconnect();
        return P.when(this.connect())
            .then(() => {
                dbg.log0('add_shard connected, calling db.admin addShard{}');
                return P.when(this.db.admin().command({
                    addShard: host + ':' + port,
                    name: shardname
                }));
            })
            .fail((err) => {
                console.error('Failed add_shard', host + ':' + port, shardname, 'with', err.message);
                throw err;
            });
    }

    update_connection_string(cfg_array) {
        //TODO:: fill this out
        //Currently seems for replica set only ...
        return;
    }

    _build_replica_config(set, members, port) {
        var rep_config = {
            _id: set,
            members: []
        };
        var id = 0;
        _.each(members, function(m) {
            rep_config.members.push({
                _id: id,
                host: m + ':' + port,
            });
            ++id;
        });

        return rep_config;
    }

    _send_command_config_rs(command) {
        return P.when(this._connect('cfg_db', this.cfg_url, this.config))
            .fail((err) => {
                console.error('MongoClient: connecting to config rs failed', err.message);
                throw err;
            })
            .then(confdb => P.when(confdb.admin().command(command)))
            .then(() => {
                dbg.log0('successfully sent command to config rs', command);
                return;
            })
            .fail((err) => {
                console.error('MongoClient: sendinbg command config rs failed', command, err.message);
                throw err;
            });
    }
}

// EXPORTS
exports.MongoClient = MongoClient;
exports.get_instance = MongoClient.get_instance;
