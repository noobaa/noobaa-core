/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../sdk/nb')} nb */

const mongodb = require('mongodb');

function is_object_id(id) {
    return (id instanceof mongodb.ObjectId);
}

function mongoObjectId() {
    // eslint-disable-next-line no-bitwise
    const timestamp = (new Date().getTime() / 1000 | 0).toString(16);
    return timestamp + 'xxxxxxxxxxxxxxxx'.replace(/[x]/g, function() {
        // eslint-disable-next-line no-bitwise
        return (Math.random() * 16 | 0).toString(16);
    }).toLowerCase();
}
exports.is_object_id = is_object_id;
exports.mongoObjectId = mongoObjectId;
