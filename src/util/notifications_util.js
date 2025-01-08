/* Copyright (C) 2024 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const config = require('../../config');
const { PersistentLogger, LogFile } = require('../util/persistent_logger');
const Kafka = require('node-rdkafka');
const os = require('os');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { get_process_fs_context } = require('./native_fs_utils');
const nb_native = require('../util/nb_native');
const http_utils = require('../util/http_utils');

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

const DEFAULT_CONNECT_FILES_DIR = '/etc/notif_connect/';

class Notificator {

    /**
     *
     * @param {Object} options
     */

    constructor({name, fs_context, connect_files_dir, nc_config_fs}) {
        this.name = name;
        this.connect_str_to_connection = new Map();
        this.notif_to_connect = new Map();
        this.fs_context = fs_context ?? get_process_fs_context();
        this.connect_files_dir = connect_files_dir ?? DEFAULT_CONNECT_FILES_DIR;
        this.nc_config_fs = nc_config_fs;
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
        //requiring system_store takes about 2 seconds for the first time
        //this time is unnecesarily added to manage_nsfs runtime
        //so I'm trying to reduce places were system store is required to minimum
        const system_store = require('../server/system_services/system_store').get_instance();
        const system_utils = require('../server/utils/system_utils');

        if (!system_store.is_finished_initial_load) {
            dbg.log0('system_store did not finish initial load');
            return false;
        }
        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

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
                await log.process(async (file, failure_append) => await this._notify(this.fs_context, file, failure_append));
            } catch (err) {
                dbg.error('processing notifications log file failed', log.file);
                throw err;
            } finally {
                await log.close();
                this.notif_to_connect.clear();
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
        const send_promises = [];
        await file.collect_and_process(async str => {
            const notif = JSON.parse(str);
            dbg.log2("notifying with notification =", notif);
            let connect = this.notif_to_connect.get(notif.meta.name);
            if (!connect) {
                connect = await this.parse_connect_file(notif.meta.connect);
                this.notif_to_connect.set(notif.meta.name, connect);
            }
            let connection = this.connect_str_to_connection.get(notif.meta.name);
            if (!connection) {
                connection = get_connection(connect);
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
            const send_promise = connection.promise_notify(notif, failure_append);
            if (send_promise) send_promises.push(send_promise);
        });
        //note we can't reject promises here, since Promise.all() is rejected on
        //first rejected promise, and that would not await other send_promises()
        await Promise.all(send_promises);

        //as failed sends are written to failure log,
        //we can remove the currently processed persistent file
        return true;
    }

    async parse_connect_file(connect_filename) {
        const filepath = path.join(this.connect_files_dir, connect_filename);
        let connect;
        if (this.nc_config_fs) {
            connect = await this.nc_config_fs.get_config_data(filepath);
        } else {
            const connect_str = fs.readFileSync(filepath, 'utf-8');
            connect = JSON.parse(connect_str);
        }
        load_files(connect);
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

    promise_notify(notif, promise_failure_cb) {
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
                promise_failure_cb(JSON.stringify(notif)).then(resolve);
            });
            req.on('timeout', () => {
                dbg.error("Notify timeout");
                req.destroy();
                promise_failure_cb(JSON.stringify(notif)).then(resolve);
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

    promise_notify(notif, promise_failure_cb) {
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
                        promise_failure_cb(JSON.stringify(notif)).then(resolve);
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


async function test_notifications(bucket, connect_files_dir) {
    const notificator = new Notificator({connect_files_dir});
    for (const notif of bucket.notifications) {
        const connect = await notificator.parse_connect_file(notif.connect);
        dbg.log1("testing notif", notif);
        try {
            const connection = get_connection(connect);
            await connection.connect();
            await connection.promise_notify({notif: "test notification"}, async err => err);
            connection.destroy();
        } catch (err) {
            dbg.error("Connection failed for", connect);
            return err;
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
function compose_notification_req(req, res, bucket, notif_conf) {
    let eTag = res.getHeader('ETag');
    //eslint-disable-next-line
    if (eTag && eTag.startsWith('\"') && eTag.endsWith('\"')) {
        eTag = eTag.substring(2, eTag.length - 2);
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
    notif.s3.object.size = res.getHeader('content-length');
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

    return compose_meta(notif, notif_conf);
}

function compose_notification_lifecycle(deleted_obj, notif_conf, bucket) {

    const notif = compose_notification_base(notif_conf, bucket);

    notif.eventName = OP_TO_EVENT.lifecycle_delete.name + ':' +
        (deleted_obj.created_delete_marker ? 'DeleteMarkerCreated' : 'Delete');
    notif.s3.object.key = deleted_obj.key;
    notif.s3.object.size = deleted_obj.size;
    notif.s3.object.eTag = deleted_obj.etag;
    notif.s3.object.versionId = deleted_obj.version_id;

    return compose_meta(notif, notif_conf);

}

function compose_meta(record, notif_conf) {
    return {
        meta: {
            connect: notif_conf.topic[0],
            name: notif_conf.id[0],
        },
        notif: {
            Records: [record],
        }
    };
}

function _get_system_name(req) {

    if (req && req.object_sdk && req.object_sdk.nsfs_system) {
        const name = Object.keys(req.object_sdk.nsfs_system)[0];
        return name;
    } else {
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

    return new PersistentLogger(config.NOTIFICATION_LOG_DIR, namespace, {
        locking,
        poll_interval,
    });
}

exports.Notificator = Notificator;
exports.test_notifications = test_notifications;
exports.compose_notification_req = compose_notification_req;
exports.compose_notification_lifecycle = compose_notification_lifecycle;
exports.check_notif_relevant = check_notif_relevant;
exports.get_notification_logger = get_notification_logger;
exports.OP_TO_EVENT = OP_TO_EVENT;
