// this module is written for both nodejs.
'use strict';

var _ = require('lodash');
var Q = require('q');
var assert = require('assert');
var moment = require('moment');
var LRU = require('noobaa-util/lru');
var db = require('./db');
var rest_api = require('../util/rest_api');
var size_utils = require('../util/size_utils');
var system_api = require('../api/system_api');
var node_monitor = require('./node_monitor');


var system_server = new system_api.Server({
    login_account: login_account,
    logout_account: logout_account,
    create_account: create_account,
    read_account: read_account,
    update_account: update_account,
    delete_account: delete_account,
    get_stats: get_stats,
});

module.exports = system_server;


// cache for accounts in memory.
// since accounts don't really change we can simply keep in the server's memory,
// and decide how much time it makes sense before expiring and re-reading from db.
var accounts_lru = new LRU({
    max_length: 200,
    expiry_ms: 600000, // 10 minutes expiry
    name: 'accounts_lru'
});

system_server.account_session = account_session;

// verify that the session has a valid account using the accounts_lru cache.
// this function is also exported to be used by other servers as a middleware.
function account_session(req, force) {
    return Q.fcall(
        function() {
            var account_id = req.session.account_id;
            if (!account_id) {
                console.error('NO ACCOUNT SESSION', account_id);
                throw new Error('not logged in');
            }

            var item = accounts_lru.find_or_add_item(account_id);

            // use cached account if not expired
            if (item.account && force !== 'force') {
                req.account = item.account;
                return req.account;
            }

            // fetch account from the database
            console.log('ACCOUNT MISS', account_id);
            return db.Account.findById(account_id).exec().then(
                function(account) {
                    if (!account) {
                        console.error('MISSING ACCOUNT SESSION', account_id);
                        throw new Error('account removed');
                    }
                    // update the cache item
                    item.account = account;
                    req.account = account;
                    return req.account;
                }
            );
        }
    );
}



function login_account(req) {
    var info = _.pick(req.rest_params, 'email');
    var password = req.rest_params.password;
    var account;
    // find account by email, and verify password
    return Q.fcall(
        function() {
            return db.Account.findOne(info).exec();
        }
    ).then(
        function(account_arg) {
            account = account_arg;
            if (account) {
                return Q.npost(account, 'verify_password', [password]);
            }
        }
    ).then(
        function(matching) {
            if (!matching) {
                throw new Error('incorrect email and password');
            }
            // insert the account id into the session
            // (expected to use secure cookie session)
            req.session.account_id = account.id;
            req.session.account_email = account.email;
        },
        function(err) {
            console.error('FAILED login_account', err);
            throw new Error('login failed');
        }
    );
}


function logout_account(req) {
    delete req.session.account_id;
    delete req.session.account_email;
}


function create_account(req) {
    var info = _.pick(req.rest_params, 'email', 'password');
    return Q.fcall(
        function() {
            return db.Account.create(info);
        }
    ).then(
        function(account) {
            // insert the account id into the session
            // (expected to use secure cookie session)
            req.session.account_id = account.id;
            req.session.account_email = account.email;
        }
    ).thenResolve().then(null,
        function(err) {
            if (err.code === 11000) {
                throw new Error('account already exists for email');
            } else {
                console.error('FAILED create_account', err);
                throw new Error('failed create account');
            }
        }
    );
}


function read_account(req) {
    return account_session(req, 'force').then(
        function() {
            return db.Account.findById(req.session.account_id).exec();
        }
    ).then(
        function(account) {
            if (!account) {
                console.error('MISSING ACCOUNT', req.session.account_id);
                throw new Error('account not found');
            }
            return {
                email: account.email,
            };
        },
        function(err) {
            console.error('FAILED read_account', err);
            throw new Error('read account failed');
        }
    );
}


function update_account(req) {
    return account_session(req, 'force').then(
        function() {
            var info = _.pick(req.rest_params, 'email', 'password');
            return db.Account.findByIdAndUpdate(req.session.account_id, info).exec();
        }
    ).thenResolve().then(null,
        function(err) {
            console.error('FAILED update_account', err);
            throw new Error('update account failed');
        }
    );
}


function delete_account(req) {
    return account_session(req, 'force').then(
        function() {
            return db.Account.findByIdAndRemove(req.session.account_id).exec();
        }
    ).thenResolve().then(null,
        function(err) {
            console.error('FAILED delete_account', err);
            throw new Error('delete account failed');
        }
    );
}


function get_stats(req) {
    var system_stats = req.rest_params.system_stats;
    var minimum_online_heartbeat = node_monitor.get_minimum_online_heartbeat();
    return account_session(req).then(
        function() {
            var account_query = system_stats && {} || {
                account: req.account.id
            };
            return Q.all([
                // nodes - count, online count, allocated/used storage
                db.Node.mapReduce({
                    query: account_query,
                    scope: {
                        // have to pass variables to map/reduce with a scope
                        minimum_online_heartbeat: minimum_online_heartbeat,
                    },
                    map: function() {
                        /* global emit */
                        emit('count', 1);
                        if (this.started && this.heartbeat >= minimum_online_heartbeat) {
                            emit('online', 1);
                        }
                        emit('alloc', this.allocated_storage);
                        emit('used', this.used_storage);
                    },
                    reduce: size_utils.reduce_sum
                }),
                // node_vendors
                db.NodeVendor.count(account_query).exec(),
                // buckets
                db.Bucket.count(account_query).exec(),
                // objects
                db.ObjectMD.count(account_query).exec(),
                // parts
                db.ObjectPart.mapReduce({
                    query: account_query,
                    map: function() {
                        /* global emit */
                        emit('size', this.end - this.start);
                    },
                    reduce: size_utils.reduce_sum
                }),
                // chunks - only in system_stats request
                system_stats && db.DataChunk.mapReduce({
                    map: function() {
                        /* global emit */
                        emit('size', this.size);
                    },
                    reduce: size_utils.reduce_sum
                }) || 0,
            ]).spread(
                function(nodes, node_vendors, buckets, objects, parts, chunks) {
                    nodes = _.mapValues(_.indexBy(nodes, '_id'), 'value');
                    parts = _.mapValues(_.indexBy(parts, '_id'), 'value');
                    chunks = chunks && _.mapValues(_.indexBy(chunks, '_id'), 'value');
                    return {
                        allocated_storage: nodes.alloc || 0,
                        used_storage: parts.size || 0,
                        chunks_storage: chunks.size || 0,
                        nodes: nodes.count || 0,
                        online_nodes: nodes.online || 0,
                        node_vendors: node_vendors || 0,
                        buckets: buckets || 0,
                        objects: objects || 0,
                    };
                }
            );
        }
    );
}
