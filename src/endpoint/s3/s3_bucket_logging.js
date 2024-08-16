/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../../util/debug_module')(__filename);
const http_utils = require('../../util/http_utils');
const dgram = require('node:dgram');
const { Buffer } = require('node:buffer');
const config = require('../../../config');

function check_notif_relevant(notif, req) {
    //if no events were specified, always notify
    if (!notif.events) return true;
    //check request's event is in notification's events list

    for (const notif_event of notif.events) {
        const notif_event_elems = notif_event.split(':');
        const event_name = notif_event_elems[1];
        const event_method = notif_event_elems[2];
        const req_s3_event_op = req.s3_event_op || req.method;
        if (!req.s3event) return false;
        if (event_name.toLowerCase() !== req.s3event.toLowerCase()) return false; //TODO
        if (event_method === '*') return true;
        if (!req_s3_event_op) return false;
        if (event_method.toLowerCase() === req_s3_event_op.toLowerCase()) return true; //TODO
    }

    //request does not match any of the requested events
    return false;
}

async function send_bucket_op_logs(req, res) {
    if (req.params && req.params.bucket && req.op_name !== 'put_bucket') {
        //potentially, there could be two writes to two different files.
        //we want to await for all writes together, instead of serially
        //so we aggregate and issue the writes only in the end
        const writes_aggregate = [];

        const bucket_info = await req.object_sdk.read_bucket_sdk_config_info(req.params.bucket);
        dbg.log2("read_bucket_sdk_config_info =  ", bucket_info);

        if (is_bucket_logging_enabled(bucket_info)) {
            dbg.log2("Bucket logging is enabled for Bucket : ", req.params.bucket);
            endpoint_bucket_op_logs(req.op_name, req, res, bucket_info, writes_aggregate);
        }

        if (req.notification_logger && bucket_info.notifications) {
            for (const notif of bucket_info.notifications) {
                if (check_notif_relevant(notif, req)) {
                    const s3_log = {
                        meta: {
                            connect: notif.connect,
                            topic: notif.topic
                        },
                        notif: get_bucket_log_record(req.op_name, bucket_info, req, res, "NOTIF")
                    };
                    dbg.log2("logging notif ", notif, ", s3_log = ", s3_log);
                    writes_aggregate.push({
                        file: req.notification_logger,
                        buffer: JSON.stringify(s3_log)
                    });
                }
            }
        }

        //by now we have all possible writes,
        //issue them concurrently and then await them
        if (writes_aggregate.length > 0) {
            const promises = [];
            for (const write of writes_aggregate) {
                promises.push(new Promise((resolve, reject) => {
                    write.file.append(write.buffer).then(resolve());
                }));
            }
            await Promise.all(promises);
        }
    }
}


function is_bucket_logging_enabled(source_bucket) {
    if (!source_bucket || !source_bucket.bucket_info.logging) {
        return false;
    }
    return true;
}

// UDP socket

const create_syslog_udp_socket = (() => {
    let client;
    let url;
    let port;
    let hostname;
    return function(syslog) {
        if (!client) {
            client = dgram.createSocket('udp4');
            process.on('SIGINT', () => {
                client.close();
                process.exit();
            });
        }
        if (!url) {
            url = new URL(syslog);
            port = parseInt(url.port, 10);
            hostname = url.hostname;
        }
        return {client, port, hostname};
    };

})();


function endpoint_bucket_op_logs(op_name, req, res, source_bucket, writes_aggregate) {

    // 1 - Get all the information to be logged in a log message.
    // 2 - Format it and send it to log bucket/syslog.
    const s3_log = get_bucket_log_record(op_name, source_bucket, req, res, "LOG");
    dbg.log1("Bucket operation logs = ", s3_log);

    switch (config.BUCKET_LOG_TYPE) {
        case 'PERSISTENT': {
            //remember this write in writes_aggregate,
            //it'll be issued later (with other potential writes)
            writes_aggregate.push({
                file: req.bucket_logger,
                buffer: JSON.stringify(s3_log)
            });
            break;
        }
        default: {
            send_op_logs_to_syslog(req.object_sdk.rpc_client.rpc.router.syslog, s3_log);
        }
    }
}

function send_op_logs_to_syslog(syslog, s3_log) {
    const buffer = Buffer.from(JSON.stringify(s3_log));
    const {client, port, hostname} = create_syslog_udp_socket(syslog);
    if (client && port && hostname) {
        client.send(buffer, port, hostname, err => {
            if (err) {
                dbg.log0("failed to send udp err = ", err);
            }
        });
    } else {
        dbg.log0(`Could not send bucket logs: client: ${client} port: ${port} hostname:${hostname}`);
    }
}

function get_bucket_log_record(op_name, source_bucket, req, res, type) {

    const client_ip = http_utils.parse_client_ip(req);
    let status_code = 102;
    if (res && res.statusCode) {
        status_code = res.statusCode;
    }
    const log = {
        op: req.method,
        bucket_owner: source_bucket.bucket_owner,
        source_bucket: req.params.bucket,
        object_key: req.originalUrl,
        remote_ip: client_ip,
        request_uri: req.originalUrl,
        http_status: status_code,
        request_id: req.request_id
    };

    //add fields unique to bucket logging
    if (type === 'LOG') {
        log.noobaa_bucket_logging = true;
        log.log_bucket = source_bucket.bucket_info.logging.log_bucket;
        log.log_prefix = source_bucket.bucket_info.logging.log_prefix;
    }

    return log;
}


exports.is_bucket_logging_enabled = is_bucket_logging_enabled;
exports.endpoint_bucket_op_logs = endpoint_bucket_op_logs;
exports.get_bucket_log_record = get_bucket_log_record;
exports.send_bucket_op_logs = send_bucket_op_logs;

