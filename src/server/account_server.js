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


/**
 *
 * ACCOUNT SERVER (REST)
 *
 */
module.exports = new api.account_api.Server({
    create_account: create_account,
    read_account: read_account,
    update_account: update_account,
    delete_account: delete_account,
});




/**
 *
 * CREATE_ACCOUNT
 *
 */
function create_account(req) {
    var info = _.pick(req.rest_params, 'name', 'email', 'password');

    return Q.when(db.Account.create(info))
        .then(null, db.check_already_exists(req, 'account'))
        .then(function(account) {

            // a token for the new account
            var token = req.make_auth_token({
                account_id: account.id,
            });

            return {
                token: token
            };
        });
}



/**
 *
 * READ_ACCOUNT
 *
 */
function read_account(req) {
    return _.pick(req.account, 'name', 'email');
}



/**
 *
 * UPDATE_ACCOUNT
 *
 */
function update_account(req) {
    // invalidate the local cache
    db.AccountCache.invalidate(req.account.id);

    // pick and send the updates
    var info = _.pick(req.rest_params, 'name', 'email', 'password');
    return Q.when(db.Account.findByIdAndUpdate(req.account.id, info).exec())
        .thenResolve();
}



/**
 *
 * DELETE_ACCOUNT
 *
 */
function delete_account(req) {
    // invalidate the local cache
    db.AccountCache.invalidate(req.account.id);

    // we just mark the deletion time to make it easy to regret
    // and to avoid stale refs side effects of actually removing from the db.
    return Q.when(db.Account.findByIdAndUpdate(req.account.id, {
            deleted: new Date()
        }).exec())
        .thenResolve();
}
