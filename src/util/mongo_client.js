'use strict';

var _ = require('lodash');
var util = require('util');
var mongodb = require('mongodb');
var EventEmitter = require('events').EventEmitter;
var P = require('./promise');
var dbg = require('./debug_module')(__filename);
var config = require('../../config.js');

class MongoClient extends EventEmitter {

    static instance() {
        if (!MongoClient._instance) {
            MongoClient._instance = new MongoClient();
        }
        return MongoClient._instance;
    }

    constructor() {
        super();
        this.db = null; // will be set once connected
        this.cfg_db = null; // will be set once a part of a cluster & connected
        this.admin_db = null;
        this.collections = {};
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
     * connect to the "real" mongodb and not the config mongo
     */
    connect() {
        dbg.log0('connect called, current url', this.url);
        this._disconnected_state = false;
        if (this.promise) return this.promise;
        let url = this.url.replace(config.MONGO_DEFAULTS.USER_PLACE_HOLDER,
            config.MONGO_DEFAULTS.DEFAULT_USER + ':roonoobaa');
        let admin_url = this.url.replace(config.MONGO_DEFAULTS.USER_PLACE_HOLDER,
            config.MONGO_DEFAULTS.DEFAULT_ADMIN_USER + ':roonoobaa').replace('/nbcore', '');
        this.promise = this._connect('db', url, this.config);
        // .then(db => {
        //     // return this._connect('admin_db', admin_url, this.config).then(() => db);
        // });
        return this.promise;
    }

    _connect(access_db, url, config) {
        if (this._disconnected_state) return;
        if (this[access_db]) return this[access_db];
        dbg.log0('_connect called with', url);
        return mongodb.MongoClient.connect(url, config)
            .then(db => {
                dbg.log0('MongoClient: connected', url);
                db.on('reconnect', () => {
                    this.emit('reconnect');
                    this._init_collections();
                    dbg.log('MongoClient: got reconnect', url);
                });
                db.on('close', () => {
                    this.emit('close');
                    dbg.warn('MongoClient: got close', url);
                });
                this[access_db] = db;
                this._init_collections();
                return db;
            }, err => {
                // autoReconnect only works once initial connection is created,
                // so we need to handle retry in initial connect.
                dbg.error('MongoClient: initial connect failed, will retry', err.message);
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

    define_collection(col) {
        if (col.name in this.collections) {
            throw new Error('Collection already defined ' + col.name);
        }
        this.collections[col.name] = col;
        return this._init_collection(col);
    }

    _init_collection(col) {
        if (!this.db) return; // will be called when connected
        return P.resolve()
            .then(() => this.db.createCollection(col.name))
            .then(() => P.map(col.db_indexes, index =>
                this.db.collection(col.name).createIndex(index.fields, _.extend({
                    background: true
                }, index.options))
                .then(res => dbg.log0('MongoClient index created', col.name, res))
                .catch(err => dbg.error('MongoClient index FAILED', col.name, index, err))
            ));
    }

    _init_collections() {
        return P.all(_.map(this.collections, col => this._init_collection(col)))
            .then(() => {
                // now print the indexes just for fun
                return P.all(_.map(this.collections, col => P.resolve()
                    .then(() => this.db.collection(col.name).indexes())
                    .then(res => dbg.log0('MongoClient indexes of', col.name, _.map(res, 'name')))
                ));
            })
            .catch(err => dbg.warn('ignoring error in _init_collections:', err));
    }

    initiate_replica_set(set, members, is_config_set) {
        var port = is_config_set ? config.MONGO_DEFAULTS.CFG_PORT : config.MONGO_DEFAULTS.SHARD_SRV_PORT;
        var rep_config = this._build_replica_config(set, members, port, is_config_set);
        var command = {
            replSetInitiate: rep_config
        };
        dbg.log0('Calling initiate_replica_set', util.inspect(command, false, null));
        if (!is_config_set) { //connect the mongod server
            return P.resolve(this.admin_db.command(command))
                .catch(err => {
                    dbg.error('Failed initiate_replica_set', set, members, 'with', err.message);
                    throw err;
                });
        }
    }

    get_mongo_rs_status() {
        return P.resolve().then(() => {
            if (this.db) {
                return P.ninvoke(this.admin_db, 'replSetGetStatus')
                    .then(status => {
                        dbg.log0('got rs status from mongo:', status);
                        if (status.ok) {
                            // return rs status fields specified in HB schema (cluster_schema)
                            let rs_status = {
                                set: status.set,
                                members: status.members.map(member => {
                                    let member_status = {
                                        name: member.name,
                                        health: member.health,
                                        uptime: member.uptime,
                                        stateStr: member.stateStr
                                    };
                                    if (member.syncingTo) {
                                        member_status.syncingTo = member.syncingTo;
                                    }
                                    return member_status;
                                })
                            };
                            return rs_status;
                        }

                    })
                    .catch(err => {
                        dbg.warn('got error when trying to get mongo rs status for HB', err.errmsg);
                    });
            }
        });
    }

    replica_update_members(set, members, is_config_set) {
        var port = is_config_set ? config.MONGO_DEFAULTS.CFG_PORT : config.MONGO_DEFAULTS.SHARD_SRV_PORT;
        var rep_config = this._build_replica_config(set, members, port, is_config_set);

        var command = {
            replSetReconfig: rep_config
        };
        return P.resolve(this.get_rs_version(is_config_set))
            .then((ver) => {
                rep_config.version = ++ver;
                dbg.log0('Calling replica_update_members', util.inspect(command, false, null));
                if (!is_config_set) { //connect the mongod server
                    return P.resolve(this.admin_db.command(command))
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
                return P.resolve(this.admin_db.command({
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

    is_master(is_config_set, set_name) {
        var command = {
            //isMaster: 1,
            replSetGetStatus: 1
        };

        if (is_config_set) {
            return P.resolve(this._send_command_config_rs(command));
        } else {
            return P.resolve(this.admin_db.command(command));
        }
    }

    get_rs_version(is_config_set) {
        var self = this;
        var command = {
            replSetGetConfig: 1
        };

        return P.fcall(function() {
                if (!is_config_set) { //connect the mongod server
                    return P.resolve(self.admin_db.command(command))
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
            ++id;
        });


        return rep_config;
    }

    _send_command_config_rs(command) {
        return P.resolve(this._connect('cfg_db', this.cfg_url, this.config))
            .catch((err) => {
                dbg.error('MongoClient: connecting to config rs failed', err.message);
                throw err;
            })
            .then(confdb => P.resolve(confdb.admin().command(command)))
            .then((res) => {
                dbg.log0('successfully sent command to config rs', util.inspect(command));
                return res;
            })
            .catch((err) => {
                dbg.error('MongoClient: sending command config rs failed', util.inspect(command), err.message);
                throw err;
            });
    }
}

// EXPORTS
exports.MongoClient = MongoClient;
exports.instance = MongoClient.instance;
