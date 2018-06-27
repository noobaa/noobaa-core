/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

function clean_null_auth_method_from_pools() {
    db.pools.updateMany({
        "cloud_pool_info.auth_method": null
    }, {
        $unset: {
            "cloud_pool_info.auth_method": 1
        }
    });
}

clean_null_auth_method_from_pools();
