/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

function add_allow_buckets_to_account() {
    db.accounts.updateMany({
        allowed_buckets: { $exists: false },
        allow_bucket_creation: { $exists: false }
    }, {
        $set: { allow_bucket_creation: false }
    });
    db.accounts.updateMany({ allow_bucket_creation: { $exists: false } }, { $set: { allow_bucket_creation: true } });
}

add_allow_buckets_to_account();
