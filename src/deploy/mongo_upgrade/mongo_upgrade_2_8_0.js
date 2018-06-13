/* Copyright (C) 2016 NooBaa */
/* eslint-env mongo */
'use strict';

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

add_create_time_to_multiparts();
