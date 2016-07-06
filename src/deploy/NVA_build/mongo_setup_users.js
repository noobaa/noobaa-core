/* global db, print, */
/* jshint -W089 */ // ignore for-in loops without hasOwnProperty checks
'use strict';

print('\nChecking mongodb users ...');
var adminDb = db.getSiblingDB('admin');
var pwd = 'roonoobaa'; // eslint-disable-line no-undef
// try to authenticate with nbadmin. if succesful nothing to do
var res = adminDb.auth('nbadmin', pwd);
if (res !== 1) {
    print('\nusers are not set. creating users ...');
    var adminUser = {
        user: 'nbadmin',
        pwd: pwd,
        roles: [{
            role: "root",
            db: "admin"
        }]
    };
    adminDb.createUser(adminUser);
    adminDb.auth('nbadmin', pwd);
    var nbcoreUser = {
        user: 'nbsrv',
        pwd: pwd,
        roles: [{
            role: "readWrite",
            db: "nbcore"
        }]
    };
    db.createUser(nbcoreUser);
}
