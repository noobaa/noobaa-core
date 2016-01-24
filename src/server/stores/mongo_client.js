'use strict';

// var _ = require('lodash');
var P = require('../../util/promise');
var mongodb = require('mongodb');

class MongoClient {

    constructor() {
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

    /**
     * connect and return the db instance which will handle reconnections.
     * mongodb_url is optional and by default takes from env or local db.
     */
    connect(url) {
        if (this.promise) return this.promise;
        if (url) this.url = url;
        this.promise = this._connect();
        return this.promise;
    }

    _connect() {
        return mongodb.MongoClient.connect(this.url, this.config)
            .then(db => {
                console.log('MongoClient: connected', this.url);
                this.db = db;
                return db;
            }, err => {
                // autoReconnect only works once initial connection is created,
                // so we need to handle retry in initial connect.
                console.error('MongoClient: initial connect failed, will retry', err.message);
                return P.delay(3000).then(() => this._connect());
            });
    }

}

module.exports = new MongoClient(); // singleton
