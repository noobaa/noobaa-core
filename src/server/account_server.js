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
var api = require('../api');


var account_server = new api.account_api.Server({
    // CRUD
    create_account: create_account,
    read_account: read_account,
    update_account: update_account,
    delete_account: delete_account,
});

module.exports = account_server;



//////////
// CRUD //
//////////


function create_account(req) {
    var info = _.pick(req.rest_params, 'name', 'email', 'password');

    return Q.when(db.Account.create(info))
        .then(null, db.check_already_exists(req, 'account'))
        .thenResolve();
}


function read_account(req) {
    return req.load_account({
            cache_miss: true
        })
        .then(function() {
            return _.pick(req.account, 'name', 'email');
        });
}


function update_account(req) {
    return req.load_account({
            cache_miss: true
        })
        .then(function() {

            // invalidate the local cache
            db.AccountCache.invalidate(req.account.id);

            // pick and send the updates
            var info = _.pick(req.rest_params, 'name', 'email', 'password');
            return db.Account.findByIdAndUpdate(req.account.id, info).exec();

        })
        .thenResolve();
}


function delete_account(req) {
    return req.load_account({
            cache_miss: true
        })
        .then(function() {

            // invalidate the local cache
            db.AccountCache.invalidate(req.account.id);

            // we just mark the deletion time to make it easy to regret
            // and to avoid stale refs side effects of actually removing from the db.
            return db.Account.findByIdAndUpdate(req.account.id, {
                deleted: new Date()
            }).exec();
        })
        .thenResolve();
}
