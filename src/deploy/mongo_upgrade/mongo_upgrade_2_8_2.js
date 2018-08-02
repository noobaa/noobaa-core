/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';



var is_pure_version;


function update_flashblade_connections() {
    if (!is_pure_version) return;

    // update connections under accounts
    var accounts = db.accounts.find({ sync_credentials_cache: { $exists: true } });
    accounts.forEach(acc => {
        var should_update = false;
        acc.sync_credentials_cache.forEach(con => {
            if (con.endpoint_type === 'S3_COMPATIBLE') {
                con.endpoint_type = 'FLASHBLADE';
                con.auth_method = 'AWS_V4';
                should_update = true;
            }
        });
        if (should_update) {
            db.accounts.updateOne({ _id: acc._id }, { $set: { sync_credentials_cache: acc.sync_credentials_cache } });
        }
    });

    // update cloud_pools that has S3 compatibles to flashblade
    db.pools.updateMany({
        'cloud_pool_info.endpoint_type': 'S3_COMPATIBLE'
    }, {
        $set: {
            'cloud_pool_info.endpoint_type': 'FLASHBLADE',
            'cloud_pool_info.auth_method': 'AWS_V4'
        }
    });
}

update_flashblade_connections();
