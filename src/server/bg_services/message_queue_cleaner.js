/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const config = require('../../../config');
const message_queue_client = require('../../util/message_queue_client');

/**
 * Dead-letter messages left above their retry limit, and delete dead messages.
 * A dead message is deleted when it is older than its queue retention, and when the queue has more than MESSAGE_QUEUE_MAX_DEAD dead messages the older ones are deleted too.
 * Both visit MESSAGE_QUEUE_REGISTERED, including queues created in another process. The idle and caught-up waits are 15 minutes.
 * A pass that fills the batch waits MESSAGE_QUEUE_CLEANER_BATCH_DELAY so the rest is removed
 * before the table grows. A pass that deletes rows and is caught up waits MESSAGE_QUEUE_CLEANER_CYCLE.
 * A pass that deletes nothing waits MESSAGE_QUEUE_CLEANER_EMPTY_DELAY.
 * A failed pass waits MESSAGE_QUEUE_CLEANER_ERROR_DELAY.
 * @returns {Promise<number>}
 */
async function background_worker() {
    const queue_client = message_queue_client.instance();
    if (!queue_client) return config.MESSAGE_QUEUE_CLEANER_EMPTY_DELAY;
    try {
        const batch = config.MESSAGE_QUEUE_CLEANER_BATCH_SIZE;
        const dead_lettered = await queue_client.dead_letter_abandoned_messages(batch);
        const expired = await queue_client.remove_expired_dead_messages(batch);

        const removed = dead_lettered.removed + expired.removed;
        const had_errors = dead_lettered.had_errors || expired.had_errors;
        const has_work = dead_lettered.has_work || expired.has_work;

        if (removed) dbg.log0(`MESSAGE_QUEUE_CLEANER: cleaned ${removed} messages`);
        if (had_errors) return config.MESSAGE_QUEUE_CLEANER_ERROR_DELAY;
        if (has_work) return config.MESSAGE_QUEUE_CLEANER_BATCH_DELAY;
        if (!removed) return config.MESSAGE_QUEUE_CLEANER_EMPTY_DELAY;

        return config.MESSAGE_QUEUE_CLEANER_CYCLE;
    } catch (err) {
        dbg.error('MESSAGE_QUEUE_CLEANER: failed', err);
        return config.MESSAGE_QUEUE_CLEANER_ERROR_DELAY;
    }
}

exports.background_worker = background_worker;
