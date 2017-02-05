/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

print('\nChecking mongodb users ...');
var nbcoreDb = db.getSiblingDB('nbcore');
var pwd = 'roonoobaa';

// try to authenticate with nbadmin. if succesful nothing to do
var res = db.auth('nbadmin', pwd);
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
    db.createUser(adminUser);
    db.auth('nbadmin', pwd);
    var nbcoreUser = {
        user: 'nbsrv',
        pwd: pwd,
        roles: [{
            role: "readWrite",
            db: "nbcore"
        }]
    };
    nbcoreDb.createUser(nbcoreUser);

    //Temporary until we will handle admin correctly for both databases
    var coretestDb = db.getSiblingDB('coretest');
    var coretestDbUser = {
        user: 'nbsrv',
        pwd: pwd,
        roles: [{
            role: "root",
            db: "admin"
        }]
    };
    coretestDb.createUser(coretestDbUser);

}
