/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const { PersistentLogger, LogFile } = require('../util/persistent_logger');
const Kafka = require('node-rdkafka');
const os = require('os');
const fs = require('fs');
const http = require('http');

class Notificator {

    /**
     *
     * @param {nb.NativeFSContext} fs_context
     */

    constructor(fs_context) {
        this.connect_str_to_connection = new Map();
        this.notif_to_connect = new Map();
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
            await log.process(async (file, failure_append) => this._notify(this.fs_context, file, failure_append));
        } catch (err) {
            dbg.error('processing notifications log file failed', log.file);
            throw err;
        } finally {
            await log.close();
            for (const connection of this.connect_str_to_connection.values()) {
                connection.destroy();
            }
        }
    }

    /**
     * @param {nb.NativeFSContext} fs_context
     * @param {string} log_file
     * @returns {Promise<Boolean>}
     */
    async _notify(fs_context, log_file, failure_append) {
        const file = new LogFile(fs_context, log_file);
        dbg.log1('sending out notificatoins from file ', log_file);
        const send_promises = [];
        await file.collect_and_process(async str => {
            const notif = JSON.parse(str);
            let connect = this.notif_to_connect.get(notif.meta.name);
            if (!connect) {
                connect = parse_connect_file(notif.meta.connect);
                this.notif_to_connect.set(notif.meta.name, connect);
            }
            let connection = this.connect_str_to_connection.get(notif.meta.name);
            if (!connection) {
                const promise_failure_cb = async err => {
                    dbg.error("failed to send notification", err);
                    await failure_append(str);
                };
                connection = get_connection(connect, promise_failure_cb);
                try {
                    await connection.connect();
                } catch (err) {
                    //failed to connect
                    dbg.error("Connection failed for", connect);
                    await failure_append(str);
                    return;
                }
                this.connect_str_to_connection.set(notif.meta.name, connection);
            }

            const send_promise = connection.promise_notify(notif);
            if (send_promise) send_promises.push(send_promise);
        });
        //note we can't reject promises here, since Promise.all() is rejected on
        //first rejected promise, and that would not await other send_promises()
        await Promise.all(send_promises);
        //as failed sends are written to failure log,
        //we can remove the currently processed persistent file
        return true;
    }
}

class HttpNotificator {

    constructor(connect_obj, promise_failure_cb) {
        this.connect_obj = connect_obj;
        this.promise_failure_cb = promise_failure_cb;
    }

    connect() {
        this.agent = new http.Agent(this.connect_obj.http_object);
    }

    promise_notify(notif) {
        return new Promise(resolve => {
            const req = http.request({agent: this.agent, method: 'POST'}, result => {
                //result.pipe(process.stdout);
                resolve();
            });
            req.on('error', err => {
                if (req.destroyed) {
                    //error emitted because of timeout, nothing more to do
                    return;
                }
                this.promise_failure_cb(err).then(resolve);
            });
            req.on('timeout', () => {
                req.destroy();
                this.promise_failure_cb('timeout for ' + JSON.stringify(notif)).then(resolve);
            });
            req.write(JSON.stringify(notif.notif));
            req.end();
        });
    }

    destroy() {
        this.agent.destroy();
    }
}

class KafkaNotificator {

    constructor(connect_obj, promise_failure_cb) {
        this.connect_obj = connect_obj;
        this.promise_failure_cb = promise_failure_cb;
    }

    async connect() {
        //kafka client doens't like options it's not familiar with
        //so delete them before connecting
        const connect_for_kafka = structuredClone(this.connect_obj);
        delete connect_for_kafka.topic;
        delete connect_for_kafka.notification_protocol;
        delete connect_for_kafka.name;
        this.connection = new Kafka.HighLevelProducer(connect_for_kafka);
        await new Promise((res, rej) => {
            this.connection.on('ready', () => {
                res();
            });
            this.connection.on('connection.failure', err => {
                rej(err);
            });
            this.connection.on('event.log', arg => {
                dbg.log1("event log", arg);
            });
            this.connection.connect();
        });
        this.connection.setPollInterval(100);
    }

    promise_notify(notif) {
        const connect_obj = this.connect_obj;
        return new Promise(resolve => {
            this.connection.produce(
                connect_obj.topic,
                null,
                Buffer.from(JSON.stringify(notif.notif)),
                null,
                Date.now(),
                (err, offset) => {
                    if (err) {
                        this.promise_failure_cb(err).then(resolve);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    destroy() {
        this.connection.flush(10000);
        this.connection.disconnect();
    }
}

function parse_connect_file(connect_filepath) {
    const connect = {};
    const connect_strs = fs.readFileSync(connect_filepath, 'utf-8').split(os.EOL);
    for (const connect_str of connect_strs) {
        if (connect_str === '') continue;
        const kv = connect_str.split('=');
        //parse JSONs-
        if (kv[0].endsWith('object')) {
            kv[1] = JSON.parse(kv[1]);
        }
        connect[kv[0]] = kv[1];
    }
    return connect;
}


function get_connection(connect, promise_failure_cb) {
    switch (connect.notification_protocol.toLowerCase()) {
        case 'http': {
            return new HttpNotificator(connect, promise_failure_cb);
        }
        case 'kafka': {
            return new KafkaNotificator(connect, promise_failure_cb);
        }
        default: {
            dbg.error("Unknown notification protocol", connect.notification_protocol);
            //nothing more to possibly do with this notification, don't append to failure log
        }
    }
}


async function test_notifications(bucket) {
    for (const notif of bucket.notifications) {
        const connect = parse_connect_file(notif.connect);
        dbg.log1("testing notif", notif);
        try {
            const connection = get_connection(connect, async err => err);
            await connection.connect();
            await connection.promise_notify({notif: "test notification"});
            connection.destroy();
        } catch (err) {
            dbg.error("Connection failed for", connect);
            return err;
        }
    }
}

exports.Notificator = Notificator;
exports.test_notifications = test_notifications;
