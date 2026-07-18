/* Copyright (C) 2026 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);

/* 
    This function will transition an object from Standard storage class to Deep Archive storage class.
    It will use the endpoint defined by the deep_archive_resource of the bucket.
*/
async function archive_object(req) {
    dbg.log1('archive_object', req.rpc_params);
    throw new Error('archive_object not yet implemented');
}

exports.archive_object = archive_object;
