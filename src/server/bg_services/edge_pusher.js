/* Copyright (C) 2016 NooBaa */
'use strict';

const config = require('../../../config');
const dbg = require('../../util/debug_module')(__filename);
const system_store = require('../system_services/system_store').get_instance();
const system_utils = require('../utils/system_utils');
const P = require('../../util/promise');
const auth_server = require('../common_services/auth_server');
const AWS = require('aws-sdk');
const ObjectIO = require('../../sdk/object_io');
const server_rpc = require('../server_rpc');


class EdgePusher {

    constructor({ name, client }) {
        this.name = name;
        this.client = client;
    }

    async run_batch() {
        if (!this._can_run()) return;

        const system = system_store.data.systems[0];
        this.auth_token = auth_server.make_auth_token({
            system_id: system._id,
            account_id: system.owner._id,
            role: 'admin'
        });
        const edge_buckets = this._get_edge_buckets();
        if (!edge_buckets || !edge_buckets.length) {
            dbg.log0('no edge buckets. nothing to do');
            return config.EDGE_PUSHER_EMPTY_DELAY;
        }

        let has_errors = false;
        dbg.log0('edge_pusher: starting batch work on buckets: ', edge_buckets.map(b => b.name).join(', '));
        await P.all(edge_buckets.map(async bucket => {
            try {
                if (!await this._is_cloud_up(bucket.namespace.write_resource.connection)) {
                    dbg.log0(`Bucket ${bucket.name} cloud connection is down: `, bucket.namespace.write_resource.connection);
                    has_errors = true;
                    return;
                }
                dbg.log0(`Working on bucket ${bucket.name}. moving next ${config.EDGE_PUSHER_BATCH_SIZE} objects`);
                const { objects } = await this.client.object.list_objects_admin({
                    bucket: bucket.name,
                    prefix: "",
                    upload_mode: false,
                    limit: config.EDGE_PUSHER_BATCH_SIZE
                }, {
                    auth_token: this.auth_token
                });
                if (objects.length === 0) {
                    dbg.log0(`bucket ${bucket.name} is empty. nothing more to do`);
                } else {
                    await this._move_objects_to_hub(bucket, objects);
                }
            } catch (err) {
                dbg.error(`got error when trying to move objects from bucket ${bucket.name} to the cloud :`, err);
                has_errors = true;
            }
        }));

        if (has_errors) {
            return config.EDGE_PUSHER_ERROR_DELAY;
        }
        return config.EDGE_PUSHER_BATCH_DELAY;

    }

    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('EdgePusher: system_store did not finish initial load');
            return false;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }

    _get_edge_buckets() {
        // return buckets that is edge_buckets
        return system_store.data.buckets.filter(bucket => Boolean(bucket.namespace && bucket.namespace.caching &&
            bucket.namespace.caching.edge_bucket));
    }

    async _is_cloud_up(connection) {
        const s3 = new AWS.S3({
            endpoint: connection.endpoint,
            accessKeyId: connection.access_key.unwrap(),
            secretAccessKey: connection.secret_key.unwrap(),
            s3ForcePathStyle: true,
            sslEnabled: false,
            s3DisableBodySigning: true,
        });
        try {
            await s3.listBuckets().promise();
            return true;
        } catch (err) {
            return false;
        }
    }

    async _move_objects_to_hub(bucket, objects) {
        const connection = bucket.namespace.write_resource.connection;
        const s3 = new AWS.S3({
            endpoint: connection.endpoint,
            accessKeyId: connection.access_key.unwrap(),
            secretAccessKey: connection.secret_key.unwrap(),
            s3ForcePathStyle: true,
            sslEnabled: false,
            // when using sigv4 we need to disable body signing to allow sending streams as body,
            // in addition disabling body signing requires working with https
            s3DisableBodySigning: true,
            // signatureVersion: sig_ver,
            // httpOptions: use_https ? {
            //     agent: new https.Agent({
            //         keepAlive: true,
            //         rejectUnauthorized: false,
            //     })
        });
        const rpc_client = server_rpc.rpc.new_client({
            auth_token: this.auth_token,
        });
        const object_io = new ObjectIO();
        await P.all(objects.map(async object => {
            dbg.log0(`Moving object :${object.key} to AWS :${connection.target_bucket}`);
            const read_stream = await object_io.read_object_stream({
                client: rpc_client,
                bucket: object.bucket,
                key: object.key,
                start: 0,
                end: object.size,
                object_md: object,
            });
            await s3.putObject({
                Bucket: connection.target_bucket,
                Key: object.key,
                Body: read_stream,
                ContentLength: object.size, //when doing stream we need to give the size
            }).promise();
            await this.client.object.delete_object({
                bucket: object.bucket,
                key: object.key
            }, {
                auth_token: this.auth_token
            });
        }));
    }
}


exports.EdgePusher = EdgePusher;
