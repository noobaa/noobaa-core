'use strict';

// var _ = require('lodash');
var P = require('../../util/promise');
var mongodb = require('mongodb');

module.exports = new MongoClient(); // singleton

function MongoClient() {
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
MongoClient.prototype.connect = function() {
    var self = this;
    if (self.db) return self.db;
    return mongodb.MongoClient.connect(self.url, self.config)
        .then(function(db) {
            console.log('MongoClient: connected', self.url);
            self.db = db;
            return db;
        }, function(err) {
            // autoReconnect only works once initial connection is created,
            // so we need to handle retry in initial connect.
            console.error('MongoClient: initial connect failed, will retry', err.message);
            return P.delay(3000).then(function() {
                return self.connect();
            });
        });
};
