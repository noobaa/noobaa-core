/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const { PersistentLogger, LogFile } = require('../util/persistent_logger');
const Kafka = require('node-rdkafka');
const os = require('os');

class KafkaNotificator {

    /**
     *
     * @param {nb.NativeFSContext} fs_context
     */

    constructor(fs_context) {
        this.connect_str_to_connection = new Map();
        this.fs_context = fs_context;
    }
    /**
     * This function will process the persistent log of bucket logging
     * and will send its notifications
     */
    async process_notification_files() {
        const node_name = process.env.NODE_NAME || os.hostname();
        const log = new PersistentLogger(config.NOTIFICATION_LOG_DIR, config.NOTIFICATION_LOG_NS + '_' + node_name, { locking: 'EXCLUSIVE' });
        try {
            await log.process(async file => this._notify(this.fs_context, file));
        } catch (err) {
            dbg.error('processing notifications log file failed', log.file);
            throw err;
        } finally {
            await log.close();
            for (const connection of this.connect_str_to_connection.values()) {
                connection.flush(1000000);
                connection.disconnect();
            }
        }
    }

    /**
     * @param {nb.NativeFSContext} fs_context
     * @param {string} log_file
     * @returns {Promise<Boolean>}
     */
    async _notify(fs_context, log_file) {
        const file = new LogFile(fs_context, log_file);
        dbg.log1('sending out kafka notificatoins from file ', log_file);
        await file.collect_and_process(async str => {
            const notif = JSON.parse(str);
            let connection = this.connect_str_to_connection.get(notif.meta.name);
            if (!connection) {
                connection = new Kafka.Producer(JSON.parse(notif.meta.connect));
                await new Promise((res, rej) => {
                    connection.on('ready', () => {
                        res();
                    });
                    connection.connect();
                });
                this.connect_str_to_connection.set(notif.meta.name, connection);
            }

            connection.produce(
                notif.meta.topic,
                null,
                Buffer.from(JSON.stringify(notif.notif)),
            );
            connection.poll();
        });
        return true;
    }
}

exports.KafkaNotificator = KafkaNotificator;
