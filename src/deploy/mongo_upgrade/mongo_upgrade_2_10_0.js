/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';


function fix_bucket_stats_writes() {
    // take both deleted and undeleted objects
    var object_count_by_bucket = db.objectmds.aggregate([{
        $match: {}
    }, {
        $group: {
            _id: '$bucket',
            count: { $sum: 1 }
        }
    }]).toArray();

    var system_id = db.systems.findOne()._id;

    // map bucket to current write count
    var writes_by_bucket = db.bucketstats.aggregate([{
        $match: {}
    }, {
        $group: {
            _id: '$bucket',
            writes: {
                $sum: '$writes'
            }
        }
    }]).toArray().reduce((obj, bucket) => {
        obj[bucket._id] = (obj[bucket._id] || 0) + bucket.writes;
        return obj;
    }, {});

    // for each bucket with objects, if there are no stats, add entry for octet/stream with the number of objects
    object_count_by_bucket.forEach(bucket => {
        const bucket_writes = writes_by_bucket[bucket._id];
        if (bucket_writes < bucket.count) {
            var selector = {
                system: system_id,
                bucket: bucket._id,
                content_type: 'application/octet-stream',
            };
            var update = {
                $set: {
                    last_write: Date.now(),
                },
                $inc: {
                    writes: bucket.count - bucket_writes
                }
            };
            print('update bucket stats:', JSON.stringify(selector), JSON.stringify(update));
            db.bucketstats.updateOne(selector, update, { upsert: true });
        }
    });
}


fix_bucket_stats_writes();
