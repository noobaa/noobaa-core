/* Copyright (C) 2016 NooBaa */
/** @typedef {typeof import('../sdk/nb')} nb */
'use strict';

const config = require('../../config');
const postgres_client = require('./postgres_client');
const mongo_client = require('./mongo_client');
const dbg = require('./debug_module')(__filename);

/**
 * @returns { nb.DBClient }
 */
function instance() {
    switch (config.DB_TYPE) {
        case 'postgres':
            return postgres_client.instance();
        case 'mongodb':
            return mongo_client.instance();
        default: {
            const str = `NON SUPPORTED DB_TYPE ${config.DB_TYPE}`;
            dbg.error(str);
            throw new Error(str);
        }
    }
}

// EXPORTS
exports.instance = instance;
