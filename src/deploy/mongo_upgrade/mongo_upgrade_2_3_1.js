/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';


function remove_cloud_sync() {
    db.buckets.updateMany({ cloud_sync: { $exists: true } }, { $unset: { cloud_sync: true } });
}

function create_exec_account() {
    var admin_account_id = db.accounts.find({
        is_support: { $exists: false }
    }).toArray()[0]._id;
    db.funcs.updateMany({
        exec_account: { $exists: false }
    }, {
        $set: { exec_account: admin_account_id }
    });
}

remove_cloud_sync();
create_exec_account();
