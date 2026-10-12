/* Copyright (C) 2016 NooBaa */
'use strict';

/** @typedef {typeof import('../sdk/nb')} nb */
const dbg = require('./debug_module')(__filename);
const config = require('../../config');
const postgres_message_queue = require('./postgres_message_queue');

/**
 * @enum {nb.MessageQueueType}
 */
const MessageQueueType = {
    POSTGRES: 'postgres',
    NONE: 'none',
};

/**
 * Return this process's queue client.
 * When MESSAGE_QUEUE_TYPE is none, the process has no queue and this returns undefined.
 * Otherwise the first call creates the client for the configured queue type, and later calls return that same client.
 * @returns {nb.MessageQueueClient | undefined}
 */
function instance() {
    const type = config.MESSAGE_QUEUE_TYPE || MessageQueueType.POSTGRES;
    switch (type) {
        case MessageQueueType.POSTGRES:
            return postgres_message_queue.instance();
        case MessageQueueType.NONE:
            return undefined;
        default: {
            const str = `NON SUPPORTED MESSAGE_QUEUE_TYPE ${type}`;
            dbg.error(str);
            throw new Error(str);
        }
    }
}

exports.MessageQueueType = MessageQueueType;
exports.instance = instance;
