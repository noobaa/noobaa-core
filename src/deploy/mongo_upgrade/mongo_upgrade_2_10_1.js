/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

/**
 * Incomplete multiparts caused issue https://github.com/noobaa/noobaa-core/issues/5153
 * and were fixed in https://github.com/noobaa/noobaa-core/pull/5166
 */
function clean_incomplete_multiparts() {
    const pre = () => `${new Date().toISOString()} clean_incomplete_multiparts:`;
    print(`${pre()} begin ...`);

    const set_uncommitted = { $set: { uncommitted: true } };

    // for objects that are uploading we mark their multiparts and parts as uncommitted
    db.objectmds.find({ deleted: null, upload_started: { $exists: true } })
        .forEach(obj => {
            print();
            print(`${pre()} object (uploading)  = ${JSON.stringify(obj)}`);
            db.objectmultiparts.find({ obj: obj._id }).forEach(mp =>
                print(`${pre()}     multipart       = ${JSON.stringify(mp)}`));
            db.objectparts.find({ obj: obj._id }).forEach(p =>
                print(`${pre()}     part            = ${JSON.stringify(p)}`));
            print(`${pre()}     update parts ...`);
            const update_parts = db.objectparts.updateMany({ obj: obj._id }, set_uncommitted);
            print(`${pre()}     update parts response ${JSON.stringify(update_parts)}`);
            print(`${pre()}     update multiparts ...`);
            const update_multiparts = db.objectmultiparts.updateMany({ obj: obj._id }, set_uncommitted);
            print(`${pre()}     update multiparts response ${JSON.stringify(update_multiparts)}`);
            print(`${pre()} end object (uploading)`);
            print();
        });

    const set_deleted = { $set: { deleted: new Date() } };

    // for incomplete multiparts of completed objects with we need to mark it as deleted.
    // We find the incomplete multiparts using num_parts:null because we already filled create_time 
    // for all the multiparts that were missing it in mongo_upgrade_2_8_0.js add_create_time_to_multiparts(),
    // so even incomplete multiparts have it.
    db.objectmultiparts.find({
            num_parts: null,
            // the uncommitted flag was added in v2.10 in PR #5166
            uncommitted: null,
            deleted: null,
        })
        .forEach(mp => {
            print();
            print(`${pre()} multipart (incomplete)  = ${JSON.stringify(mp)}`);
            const obj = db.objectmds.findOne({ _id: mp.obj });
            print(`${pre()}     object              = ${JSON.stringify(obj)}`);
            db.objectparts.find({ multipart: mp._id }).forEach(part =>
                print(`${pre()}     part            = ${JSON.stringify(part)}`));
            if (obj.upload_started) {
                // shouldn't really happen as we already marked all uploading
                print(`${pre()} skip multipart - object still uploading ...`);
            } else {
                print(`${pre()}     update parts ...`);
                const update_parts = db.objectparts.updateMany({ multipart: mp._id, deleted: null }, set_deleted);
                print(`${pre()}     update parts response ${JSON.stringify(update_parts)}`);
                print(`${pre()}     update multipart ...`);
                const update_multiparts = db.objectmultiparts.updateOne({ _id: mp._id, deleted: null }, set_deleted);
                print(`${pre()}     update multipart response ${JSON.stringify(update_multiparts)}`);
                print(`${pre()} end multipart (incomplete)`);
            }
            print();
        });

    print(`${pre()} all done.`);
}

clean_incomplete_multiparts();
