'use strict';

var _ = require('lodash');
var P = require('../../util/promise');
var config = require('../../../config.js');
var mongodb = require('mongodb');
var EventEmitter = require('events').EventEmitter;

class MongoClient extends EventEmitter {

    constructor() {
        super();
        this.db = null; // will be set once connected
        this.url =
            process.env.MONGODB_URL ||
            process.env.MONGOHQ_URL ||
            process.env.MONGOLAB_URI ||
            'mongodb://127.0.0.1/nbcore';
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
        this._disconnected_state = false;
        if (this.promise) return this.promise;
        this.promise = this._connect();
        return this.promise;
    }

    _connect() {
        if (this._disconnected_state) return;
        if (this.db) return this.db;
        return mongodb.MongoClient.connect(this.url, this.config)
            .then(db => {
                console.log('MongoClient: connected', this.url);
                db.on('reconnect', () => this.emit('reconnect'));
                this.db = db;
                return db;
            }, err => {
                // autoReconnect only works once initial connection is created,
                // so we need to handle retry in initial connect.
                console.error('MongoClient: initial connect failed, will retry', err.message);
                return P.delay(3000).then(() => this._connect());
            });
    }

    disconnect() {
        this._disconnected_state = true;
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    initiate_replica_set(set, members, is_config_set) {
        var rep_config = this._build_replica_config(set, members);
        var command = {
            replSetInitiate: rep_config
        };
        if (!is_config_set) { //connect the mongod server
            return P.when(this.db.admin.command(command));
        } else { //connect the server running the config replica set
            return this._send_command_config_rs(command);
        }
    }

    replica_update_members(set, members, is_config_set) {
        var rep_config = this._build_replica_config(set, members);
        var command = {
            replSetReconfig: rep_config
        };
        if (!is_config_set) { //connect the mongod server
            return P.when(this.db.admin.command(command));
        } else { //connect the server running the config replica set
            return this._send_command_config_rs(command);
        }
    }

    add_shard(host, port) {
        return P.when(this.db.admin.command({
            addShard: host + ':' + port
        }));
    }

    update_connection_string(cfg_array) {
        //TODO:: fill this out
        //Currently seems for replica set only ...
        return;
    }

    _build_replica_config(set, members) {
        var rep_config = {
            _id: set,
            members: []
        };
        var id = 0;
        _.each(members, function(m) {
            rep_config.members.push({
                _id: id,
                host: m,
            });
            ++id;
        });

        return rep_config;
    }

    _send_command_config_rs(command) {
        return mongodb.MongoClient.connect('mongodb://127.0.0.1:' + config.MONGO_DEFAULTS.CFG_PORT + '/config0', this.config)
            .then(confdb => {
                return P.when(confdb.admin.command(command))
                    .then(() => confdb.close());
            }, err => {
                console.error('MongoClient: connecting to config rs failed', err.message);
            });
    }
}

module.exports = new MongoClient(); // singleton
