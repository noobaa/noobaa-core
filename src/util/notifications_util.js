/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const { PersistentLogger } = require('../util/persistent_logger');
const Kafka = require('node-rdkafka');
const os = require('os');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { get_process_fs_context } = require('./native_fs_utils');
const nb_native = require('../util/nb_native');
const http_utils = require('../util/http_utils');
const nc_mkm = require('../manage_nsfs/nc_master_key_manager').get_instance();
const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;
const {ConfigFS} = require('../sdk/config_fs');
const _ = require('lodash');

const OP_TO_EVENT = Object.freeze({
    put_object: { name: 'ObjectCreated' },
    post_object: { name: 'ObjectCreated' },
    post_object_uploadId: { name: 'ObjectCreated', method: 'CompleteMultipartUpload' },
    delete_object: { name: 'ObjectRemoved' },
    post_object_restore: { name: 'ObjectRestore' },
    put_object_acl: { name: 'ObjectAcl' },
    put_object_tagging: { name: 'ObjectTagging' },
    delete_object_tagging: { name: 'ObjectTagging' },
    lifecycle_delete: { name: 'LifecycleExpiration' },
});

class Notificator {

    /**
     *
     * @param {Object} options
     */

    constructor({name, fs_context, connect_files_dir, nc_config_fs, batch_size}) {
        this.name = name;
        this.connect_str_to_connection = new Map();
        this.notif_to_connect = new Map();
        this.fs_context = fs_context ?? get_process_fs_context();
        this.connect_files_dir = connect_files_dir ?? config.NOTIFICATION_CONNECT_DIR;
        this.nc_config_fs = nc_config_fs;
        this.batch_size = batch_size || config.NOTIFICATION_BATCH || 10;

        //requiring system_store takes about 2 seconds for the first time
        //this time is unnecesarily added to manage_nsfs runtime, which fails nsfs tests on timeout
        //so I'm trying to reduce places were system store is required to minimum
        this.system_store = require('../server/system_services/system_store').get_instance();
        this.system_utils = require('../server/utils/system_utils');
    }

    async run_batch() {
        if (!this._can_run()) return;
        try {
            await this.process_notification_files();
        } catch (err) {
            dbg.error('Notificator failure:', err);
        }

        return 100; //TODO
    }

    _can_run() {
        if (!this.system_store.is_finished_initial_load) {
            dbg.log0('system_store did not finish initial load');
            return false;
        }
        const system = this.system_store.data.systems[0];
        if (!system || this.system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }

    /**
     * This function will process the persistent log of bucket logging
     * and will send its notifications
     */
    async process_notification_files() {
        const seen_nodes = new Set();
        const entries = await nb_native().fs.readdir(this.fs_context, config.NOTIFICATION_LOG_DIR);
        for (const entry of entries) {
            if (!entry.name.endsWith('.log')) continue;
            //get namespace
            const namepsace_index = entry.name.indexOf(config.NOTIFICATION_LOG_NS);
            if (namepsace_index === -1) continue;
            const node_namespace = entry.name.substring(0, namepsace_index + config.NOTIFICATION_LOG_NS.length);
            if (seen_nodes.has(node_namespace)) {
                //already handled this node name
                continue;
            } else {
                seen_nodes.add(node_namespace);
            }
            dbg.log1("process_notification_files node_namespace =", node_namespace, ", file =", entry.name);
            const log = get_notification_logger('EXCLUSIVE', node_namespace);
            try {
                await log.process(async (file, failure_append) => await this._notify(file, failure_append));
            } catch (err) {
                dbg.error('processing notifications log file failed', log.file);
                throw err;
            } finally {
                await log.close();
                for (const conn of this.connect_str_to_connection.values()) {
                    conn.destroy();
                }
                this.connect_str_to_connection.clear();
                this.notif_to_connect.clear();
            }
        }
    }

    /**
     * @param {import('../util/persistent_logger').LogFile} file
     * @param {(entry: string) => Promise<void>} failure_append
     * @returns {Promise<Boolean>}
     */
    async _notify(file, failure_append) {
        let send_promises = [];
        let notif;
        await file.collect_and_process(async str => {
            try {
                notif = null;
                dbg.log2("notifying with notification =", str);
                notif = JSON.parse(str);
                let connect = this.notif_to_connect.get(notif.meta.name);
                if (!connect) {
                    connect = await this.parse_connect_file(notif.meta.connect, true);
                    this.notif_to_connect.set(notif.meta.name, connect);
                }
                let connection = this.connect_str_to_connection.get(notif.meta.name);
                if (!connection) {
                    connection = get_connection(connect);
                    await connection.connect();
                    this.connect_str_to_connection.set(notif.meta.name, connection);
                }
                const send_promise = connection.promise_notify(notif, this.handle_failed_notification.bind(this), failure_append);
                if (send_promise) send_promises.push(send_promise);
                if (send_promises.length > this.batch_size) {
                    await Promise.all(send_promises);
                    send_promises = [];
                }
            } catch (err) {
                dbg.error("Failed to notify. err = ", err, ", str =", str);
                //re-write the failed notification if it's still configured on the bucket
                if (notif) {
                    await this.handle_failed_notification(notif, failure_append, err);
                }
            }
        });
        //note we can't reject promises here, since Promise.all() is rejected on
        //first rejected promise, and that would not await other send_promises()
        await Promise.all(send_promises);

        //as failed sends are written to failure log,
        //we can remove the currently processed persistent file
        return true;
    }

    async handle_failed_notification(notif, failure_append, err) {
        if (this.nc_config_fs) {
            new NoobaaEvent(NoobaaEvent.NOTIFICATION_FAILED).create_event(notif?.meta?.name, err, err?.toString());
        }

        if (notif) {
            let bucket;
            //re-write the failed notification in the persitent log, unless
            //it is no longer configured on the bucket
            if (this.nc_config_fs) {
                bucket = await this.nc_config_fs.get_bucket_by_name(notif.meta.bucket);
            } else {
                const system = this.system_store.data.systems[0];
                bucket = system.buckets_by_name && system.buckets_by_name[notif.meta.bucket];
            }
            if (bucket.notifications) {
                for (const notif_conf of bucket.notifications) {
                    if (notif_conf.id[0] === notif.meta.name) {
                        //notification is still configured, rewrite it
                        await failure_append(JSON.stringify(notif));
                        break;
                    }
                }
            }
        }
    }

    async parse_connect_file(connection_name, decrypt = false) {
        let connect;
        let connect_filename = connection_name;
        let kafka_topic_from_connection_name;
        if (connection_name.startsWith("kafka:::topic/")) {
            const connection_parts = connection_name.split('/');
            connect_filename = connection_parts[1];
            kafka_topic_from_connection_name = connection_parts.length > 1 && connection_parts[2];
        }

        if (this.nc_config_fs) {
            connect = await this.nc_config_fs.get_connection_by_name(connect_filename);
        } else {
            const filepath = path.join(this.connect_files_dir, connect_filename);
            const connect_str = fs.readFileSync(filepath, 'utf-8');
            connect = JSON.parse(connect_str);
        }

        //if connect file is encrypted (and decryption is requested),
        //decrypt the auth field
        if (connect.master_key_id && connect.request_options_object.auth && decrypt) {
            connect.request_options_object.auth = await nc_mkm.decrypt(
                connect.request_options_object.auth, connect.master_key_id);
        }
        load_files(connect);

        //use the kafka topic, if it was present in connection_name
        if (kafka_topic_from_connection_name) {
            connect.topic = kafka_topic_from_connection_name;
        }
        return connect;
    }
}

class HttpNotificator {

    constructor(connect_obj) {
        this.connect_obj = connect_obj;
        this.protocol = connect_obj.notification_protocol.toLowerCase() === 'https' ? https : http;
    }

    connect() {
        this.agent = new this.protocol.Agent(this.connect_obj.agent_request_object);
    }

    promise_notify(notif, promise_failure_cb, failure_ctxt) {
        return new Promise(resolve => {
            const req = this.protocol.request({
                agent: this.agent,
                method: 'POST',
                ...this.connect_obj.request_options_object},
                result => {
                //result.pipe(process.stdout);
                resolve();
            });
            req.on('error', err => {
                if (req.destroyed) {
                    //error emitted because of timeout, nothing more to do
                    return;
                }
                dbg.error("Notify err =", err);
                promise_failure_cb(notif, failure_ctxt, err).then(resolve);
            });
            req.on('timeout', () => {
                dbg.error("Notify timeout");
                req.destroy();
                promise_failure_cb(notif, failure_ctxt).then(resolve);
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

    constructor(connect_obj) {
        this.connect_obj = connect_obj;
    }

    async connect() {
        this.connection = new Kafka.HighLevelProducer(this.connect_obj.kafka_options_object);
        dbg.log2("Kafka producer connecting, connect =", this.connect_obj);
        await new Promise((res, rej) => {
            this.connection.on('ready', () => {
                dbg.log2("Kafka producer connected for connection =", this.connect_obj);
                res();
            });
            this.connection.on('connection.failure', err => {
                dbg.error("Kafka producer failed to connect. connect = ", this.connect_obj, ", err =", err);
                rej(err);
            });
            this.connection.on('event.log', arg => {
                dbg.log2("event log", arg);
            });
            this.connection.on('event.error', arg => {
                dbg.error("event error =", arg);
            });
            this.connection.connect();
        });
        dbg.log2("Kafka producer's connect done, connect =", this.connect_obj);
        this.connection.setPollInterval(100);
    }

    promise_notify(notif, promise_failure_cb, failure_ctxt) {
        const connect_obj = this.connect_obj;
        return new Promise(resolve => {
            this.connection.produce(
                connect_obj.topic,
                null,
                Buffer.from(JSON.stringify(notif.notif)),
                null,
                Date.now(),
                err => {
                    if (err) {
                        dbg.error("Failed to notify. Connect =", connect_obj, ", notif =", notif);
                        promise_failure_cb(notif, failure_ctxt, err).then(resolve);
                    } else {
                        dbg.log2("Kafka notify successful. Connect =", connect_obj, ", notif =", notif);
                        resolve();
                    }
                }
            );
        });
    }

    destroy() {
        if (this.connection.isConnected()) {
            this.connection.flush(10000);
            this.connection.disconnect();
        }
    }
}

//replace properties starting with 'local_file'
//with the content of the pointed file
//(useful for loading tls certificates into http options object)
function load_files(object) {
    if (typeof object !== 'object') return;
    for (const key in object) {
        if (key.startsWith('local_file')) {
            const new_key = key.substring('local_file_'.length);
            const content = fs.readFileSync(object[key], 'utf-8');
            object[new_key] = content;
            delete object[key];
        } else {
            load_files(object[key]);
        }
    }
    dbg.log2('load_files for obj =', object);
}

function get_connection(connect) {
    switch (connect.notification_protocol.toLowerCase()) {
        case 'http':
        case 'https':
        {
            return new HttpNotificator(connect);
        }
        case 'kafka': {
            return new KafkaNotificator(connect);
        }
        default: {
            dbg.error("Unknown notification protocol", connect.notification_protocol);
            //nothing more to possibly do with this notification, don't append to failure log
        }
    }
}

/**
 * Try to send a test notification for each of the notification configuration.
 * If there's a failure, return it.
 * @param {*} notifs notificatoin config to test
 * @param {*} nc_config_dir path to NC conf dir (if system is NC)
 * @returns {Promise} Error while testing, if any.
 */

async function test_notifications(notifs, nc_config_dir, req) {
    //notifs can be empty in case we're removing the notification from the bucket
    if (!notifs) {
        return;
    }
    let connect_files_dir = config.NOTIFICATION_CONNECT_DIR;
    let config_fs;
    if (nc_config_dir) {
        config_fs = new ConfigFS(nc_config_dir);
        connect_files_dir = config_fs.connections_dir_path;
    }
    const notificator = new Notificator({connect_files_dir, nc_config_fs: config_fs});
    for (const notif of notifs) {
        let connect;
        let connection;
        let failure = false;
        let notif_failure;
        try {
            connect = await notificator.parse_connect_file(notif.topic[0]);
            dbg.log0(`effective connect for notif ${notif.id[0]} is`, connect);
            connection = get_connection(connect);
            await connection.connect();
            await connection.promise_notify(compose_notification_test(req), async (notif_cb, err_cb, err) => {
                failure = true;
                notif_failure = err;
            });
            if (failure) {
                if (notif_failure) {
                    throw notif_failure;
                }
                //no error was thrown during notify, throw generic error
                throw new Error();
            }
        } catch (err) {
            dbg.error("Connection failed for", notif, ", connect =", connect, ", err = ", err);
            return err;
        } finally {
            if (connection) {
                connection.destroy();
            }
        }
    }
}

function compose_notification_base(notif_conf, bucket, req) {

    const event_time = new Date();

    const notif = {
        eventVersion: '2.3',
        eventSource: _get_system_name(req) + ':s3',
        eventTime: event_time.toISOString(),

        s3: {
            s3SchemaVersion: "1.0",
            configurationId: notif_conf.name,
            object: {
                //default for sequencer, overriden in compose_notification_req for noobaa ns
                sequencer: event_time.getTime().toString(16),
            },
            bucket: {
                name: bucket.name,
                ownerIdentity: {
                    //buckets from s3 reqs are sdk-style, from lifcycle are "raw" system store object
                    principalId: bucket.bucket_owner ? bucket.bucket_owner.unwrap() : bucket.owner_account.name.unwrap(),
                },
                arn: "arn:aws:s3:::" + bucket.name,
            },
        }
    };

    return notif;

}

//see https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html
function compose_notification_req(req, res, bucket, notif_conf, reply) {
    //most s3 ops put etag in header. CompleteMultipartUploadResult is an exception.
    let eTag = res.getHeader('ETag') || reply?.CompleteMultipartUploadResult?.ETag;
    //eslint-disable-next-line
    if (eTag && eTag.startsWith('\"') && eTag.endsWith('\"')) {
        eTag = eTag.substring(1, eTag.length - 1);
    }

    const event = OP_TO_EVENT[req.op_name];
    const http_verb_capitalized = req.method.charAt(0).toUpperCase() + req.method.slice(1).toLowerCase();

    const notif = compose_notification_base(notif_conf, bucket, req);

    notif.eventName = event.name + ':' + (event.method || req.s3_event_method || http_verb_capitalized);
    notif.userIdentity = {
        principalId: req.object_sdk.requesting_account.name,
    };
    notif.requestParameters = {
        sourceIPAddress: http_utils.parse_client_ip(req),
        };
    notif.responseElements = {
            "x-amz-request-id": req.request_id,
            "x-amz-id-2": req.request_id,
    };
    notif.s3.object.key = req.params.key;
    notif.s3.object.size = res.size_for_notif;
    notif.s3.object.eTag = eTag;
    notif.s3.object.versionId = res.getHeader('x-amz-version-id');

    //handle glacierEventData
    if (res.restore_object_result) {
        notif.glacierEventData = {
            restoreEventData: {
                lifecycleRestorationExpiryTime: res.restore_object_result.expires_on.toISOString(),
                lifecycleRestoreStorageClass: res.restore_object_result.storage_class,
            },
        };
    }

    //handle sequencer
    if (res.seq) {
        //in noobaa-ns we have a sequence from db
        notif.s3.object.sequencer = res.seq;
    }

    delete res.size_for_notif;

    return compose_meta(notif, notif_conf, bucket);
}

function compose_notification_lifecycle(deleted_obj, notif_conf, bucket, object_sdk) {

    const notif = compose_notification_base(notif_conf, bucket, {object_sdk});

    notif.eventName = OP_TO_EVENT.lifecycle_delete.name + ':' +
        (deleted_obj.created_delete_marker ? 'DeleteMarkerCreated' : 'Delete');
    notif.s3.object.key = deleted_obj.key;
    notif.s3.object.size = deleted_obj.size;
    notif.s3.object.eTag = deleted_obj.etag;
    notif.s3.object.versionId = deleted_obj.version_id;

    return compose_meta(notif, notif_conf, bucket);

}

function compose_meta(record, notif_conf, bucket) {
    return {
        meta: {
            connect: notif_conf.topic[0],
            name: notif_conf.id[0],
            bucket: bucket.name,
        },
        notif: {
            Records: [record],
        }
    };
}

function compose_notification_test(req) {
    return {
        notif: {
            Records: [{
                Service: "NooBaa",
                Event: "s3:TestEvent",
                Time: new Date().toISOString(),
                Bucket: req.params.bucket,
                RequestId: req.request_id,
                HostId: process.env.NODE_NAME || os.hostname()
            }]
        }
    };
}

function _get_system_name(req) {

    //in NC case - return node name
    if (req && req.object_sdk && req.object_sdk.nsfs_system) {
        const name = process.env.NODE_NAME || os.hostname();
        return name;
    } else { //in containerized - return system's name
        //see comment on Notificator._can_run() for the require here
        const system_store = require('../server/system_services/system_store').get_instance();
        return system_store.data.systems[0].name;
    }
}

function check_notif_relevant(notif, req) {
    const op_event = OP_TO_EVENT[req.op_name];
    if (!op_event) {
        //s3 op is not relevant for notifications
        return false;
    }

    //if no events were specified, always notify
    if (!notif.event) return true;

    //check request's event is in notification's events list
    for (const notif_event of notif.event) {
        const notif_event_elems = notif_event.split(':');
        const notif_event_name = notif_event_elems[1];
        const notif_event_method = notif_event_elems[2];
        if (notif_event_name.toLowerCase() !== op_event.name.toLowerCase()) continue;
        //is there filter by method?
        if (notif_event_method === '*') {
            //no filtering on method. we've passed the filter and need to send a notification
            return true;
        }
        //take request method by this order
        //1 op_event.method - in case method can be inferred from req.op_name, eg s3_post_object_uploadId
        //2 op explicitly set req.s3_event_method, eg DeleteMarkerCreated
        //3 default to req.method (aka "http verb") eg get/post/delete
        const op_method = op_event.method || req.s3_event_method || req.method;
        if (notif_event_method.toLowerCase() === op_method.toLowerCase()) return true;
    }

    //request does not match any of the requested events
    return false;
}

/**
 *
 * @param {"SHARED" | "EXCLUSIVE"} locking counterintuitively, either 'SHARED' for writing or 'EXCLUSIVE' for reading
 */
function get_notification_logger(locking, namespace, poll_interval) {
    if (!namespace) {
        const node_name = process.env.NODE_NAME || os.hostname();
        namespace = node_name + '_' + config.NOTIFICATION_LOG_NS;
    }

    const logger = new PersistentLogger(config.NOTIFICATION_LOG_DIR, namespace, {
        locking,
        poll_interval,
    });

    //initialize writes_counter, used in check_free_space
    logger.writes_counter = 0;

    return logger;
}

//If space check is configures, create an event in case free space is below threshold.
function check_free_space_if_needed(req) {
    if (!req.object_sdk.nsfs_config_root || !config.NOTIFICATION_REQ_PER_SPACE_CHECK) {
        //free space check is disabled. nothing to do.
        return;
    }
    req.notification_logger.writes_counter += 1;

    //is it time to check?
    if (req.notification_logger.writes_counter > config.NOTIFICATION_REQ_PER_SPACE_CHECK) {
        //yes. remember we've just ran  the check by zero-ing the counter.
        req.notification_logger.writes_counter = 0;
        const fs_stat = fs.statfsSync(config.NOTIFICATION_LOG_DIR);
        //is the ratio of available blocks less than the configures threshold?
        if (check_free_space().below) {
            //yes. raise an event.
            new NoobaaEvent(NoobaaEvent.NOTIFICATION_LOW_SPACE).create_event(null, {fs_stat});
        }
    }
}

function check_free_space() {
    const fs_stat = fs.statfsSync(config.NOTIFICATION_LOG_DIR);
    const ratio = fs_stat.bavail / fs_stat.blocks;
    //is the ratio of available blocks less than the configures threshold?
    return {
        below: ratio < config.NOTIFICATION_SPACE_CHECK_THRESHOLD,
        ratio
    };
}

/**
 * add_connect_file Creates a new connection file from the given content.
 * If content has an auth field in it's request_options_object, it is encrypted.
 * @param {Object} content  connection file content
 * @param {Object} nc_config_fs NC config fs object
 * @returns A possible encrypted target connection file
 */
async function add_connect_file(content, nc_config_fs) {
    for (const key in content) {
        if (key.endsWith("_object") && typeof content[key] === 'string') {
            content[key] = JSON.parse(content[key]);
        }
    }
    await encrypt_connect_file(content);
    await nc_config_fs.create_connection_config_file(content.name, content);
    return content;
}

/**
 * update_connect_file Updates given key in the connection file.
 * If value is specified, this value is assigned to the key.
 * If remove_key is specified, key is removed.
 * @param {string} name connection file name
 * @param {string} key key name to be updated
 * @param {string} value new value for the key
 * @param {boolean} remove_key should key be removed
 * @param {Object} nc_config_fs NC config fs
 */
async function update_connect_file(name, key, value, remove_key, nc_config_fs) {
    const data = await nc_config_fs.get_connection_by_name(name);
    if (remove_key) {
        delete data[key];
    } else {
        //if update initiated in cli, object fields need to be parsed
        if (key.endsWith('_object') && typeof value === 'string') {
            value = JSON.parse(value);
        }
        data[key] = value;
    }
    await encrypt_connect_file(data);
    await nc_config_fs.update_connection_file(name, data);
}

/**
 * encrypt_connect_file Encrypted request_options_object.auth field, if present.
 * Sets the 'encrypt' field to true.
 * @param {Object} data connection's file content
 */
async function encrypt_connect_file(data) {
    if (data.request_options_object && data.request_options_object.auth && !data.master_key_id) {
        await nc_mkm.init();
        data.request_options_object.auth = nc_mkm.encryptSync(data.request_options_object.auth);
        data.master_key_id = nc_mkm.active_master_key.id;
    }
}

/**
 * @param {Object} bucket
 * @param {String} event_name
 * @returns {Boolean}
 */
function should_notify_on_event(bucket, event_name) {
    return config.NOTIFICATION_LOG_DIR && bucket.notifications &&
    _.some(bucket.notifications, notif =>
    (!notif.Events || _.some(notif.Events, event => event.includes(event_name))));
}

exports.Notificator = Notificator;
exports.test_notifications = test_notifications;
exports.compose_notification_req = compose_notification_req;
exports.compose_notification_lifecycle = compose_notification_lifecycle;
exports.check_notif_relevant = check_notif_relevant;
exports.get_notification_logger = get_notification_logger;
exports.add_connect_file = add_connect_file;
exports.update_connect_file = update_connect_file;
exports.check_free_space = check_free_space;
exports.check_free_space_if_needed = check_free_space_if_needed;
exports.should_notify_on_event = should_notify_on_event;
exports.OP_TO_EVENT = OP_TO_EVENT;
