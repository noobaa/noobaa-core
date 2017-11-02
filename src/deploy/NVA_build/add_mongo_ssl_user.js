/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
/* global setVerboseShell*/
'use strict';

// the following params are set from outside the script
// using mongo --eval 'var param_ip="..."' and we only declare them here for completeness
var param_client_subject;

function add_ssl_user() {
    var user = db.getSiblingDB("$external").getUser(param_client_subject);
    if (user) {
        print('\nDB already contains a user for subject', param_client_subject);
    } else {
        print('\nAdding a DB user for subject', param_client_subject);
        db.getSiblingDB("$external").runCommand({
            createUser: param_client_subject,
            roles: [{
                role: "root",
                db: 'admin'
            }]
        });
    }
}

add_ssl_user();