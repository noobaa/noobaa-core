/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

function give_all_buckets_owner() {
    var system_owner = db.systems.findOne().owner;
    db.buckets.updateMany({}, {
        $set: {
            owner_account: system_owner
        }
    });
}

give_all_buckets_owner();
