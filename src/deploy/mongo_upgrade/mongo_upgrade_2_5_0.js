/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';


function update_versioning_for_buckets() {
    db.buckets.updateMany({ versioning: { $exists: false } }, { $set: { versioning: 'DISABLED' } });
}

function remove_mongodb_object_mds_index() {
    // We are no longer interested in the current index so we want to remove it and build new indexes
    // The creation process will be managed in the background on services start
    db.objectmds.dropIndex('bucket_1_key_1_deleted_1_upload_started_1');
}

update_versioning_for_buckets();
remove_mongodb_object_mds_index();
