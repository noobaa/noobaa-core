/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';


function update_buckets_set_versioning() {
    db.buckets.updateMany({ versioning: { $exists: false } }, { $set: { versioning: 'DISABLED' } });
}

function update_buckets_unset_cloud_sync() {
    db.buckets.updateMany({ cloud_sync: { $exists: false } }, { $unset: { cloud_sync: 1 } });
}

function drop_old_md_indexes() {
    // We are no longer interested in the current index so we want to remove it and build new indexes
    // The creation process will be managed in the background on services start
    db.objectmds.dropIndex('bucket_1_key_1_deleted_1_upload_started_1');
    db.objectmds.dropIndex('bucket_1_cloud_synced_1_deleted_1');
}

function add_create_time_to_multiparts() {
    var cursor = db.objectmultiparts.find({ deleted: null, create_time: null });
    while (cursor.hasNext()) {
        var bulk = db.objectmultiparts.initializeUnorderedBulkOp();
        var count = cursor.objsLeftInBatch();
        print('count', count);
        for (var i = 0; i < count; ++i) {
            var multipart = cursor.next();
            var create_time = multipart._id.getTimestamp();
            print('update multipart', multipart._id, 'create_time', create_time, 'left', cursor.objsLeftInBatch());
            bulk.find({ _id: multipart._id })
                .updateOne({ $set: { create_time } });
        }
        print('execute');
        bulk.execute();
    }
}

function fix_upgrade_stage_changed_date() {
    db.clusters.updateMany({}, {
        $unset: {
            "stage_changed_date": 1
        }
    });
}

update_buckets_set_versioning();
update_buckets_unset_cloud_sync();
drop_old_md_indexes();
add_create_time_to_multiparts();
fix_upgrade_stage_changed_date();
