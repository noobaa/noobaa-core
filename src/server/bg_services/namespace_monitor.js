/* Copyright (C) 2016 NooBaa */
'use strict';

const system_store = require('../system_services/system_store').get_instance();
const azure_storage = require('../../util/new_azure_storage_wrap');
const auth_server = require('../common_services/auth_server');
const dbg = require('../../util/debug_module')(__filename);
const system_utils = require('../utils/system_utils');
const cloud_utils = require('../../util/cloud_utils');
const nb_native = require('../../util/nb_native');
const config = require('../../../config');
const P = require('../../util/promise');
const AWS = require('aws-sdk');

class NamespaceMonitor {

    /**
     * @param {{
     *   name: string;
     *   client: nb.APIClient;
     *   should_monitor: (nsr: nb.NamespaceResource) => boolean;
     * }} params
     */
    constructor({ name, client, should_monitor }) {
        this.name = name;
        this.client = client;
        this.nsr_connections_obj = {};
        this.should_monitor = should_monitor;
    }

    async run_batch() {
        if (!this._can_run()) return;
        dbg.log1('namespace_monitor: starting monitoring namespace resources');
        try {
            await this.test_namespace_resources_validity();
        } catch (err) {
            dbg.error('namespace_monitor:', err, err.stack);
        }
        return config.NAMESPACE_MONITOR_DELAY;
    }

    _can_run() {
        if (!system_store.is_finished_initial_load) {
            dbg.log0('namespace_monitor: system_store did not finish initial load');
            return false;
        }

        const system = system_store.data.systems[0];
        if (!system || system_utils.system_in_maintenance(system._id)) return false;

        return true;
    }

    async test_namespace_resources_validity() {

        await P.map_with_concurrency(10, system_store.data.namespace_resources, async nsr => {
            if (!this.should_monitor(nsr)) return;

            const endpoint_type = nsr.nsfs_config ? 'NSFS' : nsr.connection.endpoint_type;

            try {
                if (endpoint_type === 'NSFS') {
                    await this.test_nsfs_resource(nsr);
                } else if (['AWS', 'AWSSTS', 'S3_COMPATIBLE', 'IBM_COS'].includes(endpoint_type)) {
                    await this.test_s3_resource(nsr);
                } else if (endpoint_type === 'AZURE') {
                    await this.test_blob_resource(nsr);
                } else {
                    dbg.error('namespace_monitor: invalid endpoint type', endpoint_type);
                }
                await this.update_last_monitoring(nsr._id, nsr.name);
            } catch (err) {
                await this.run_update_issues_report(err, nsr);
                dbg.log1(`test_namespace_resource_validity: namespace resource ${nsr.name} has error as expected`);
            }
        });
        dbg.log1(`test_namespace_resource_validity finished successfully..`);
    }

    async run_update_issues_report(err, nsr) {
        if (!err.code) return;
        await this.client.pool.update_issues_report({
            namespace_resource_id: nsr._id,
            error_code: String(err.code),
            time: Date.now(),
            monitoring: true
        }, {
            auth_token: auth_server.make_auth_token({
                system_id: system_store.data.systems[0]._id,
                account_id: system_store.data.systems[0].owner._id,
                role: 'admin'
            })
        });
    }

    async update_last_monitoring(nsr_id, nsr_name) {
        dbg.log0(`update_last_monitoring: monitoring for ${nsr_name}, ${nsr_id} finished successfully..`);
        await system_store.make_changes({
            update: {
                namespace_resources: [{
                    _id: nsr_id,
                    $set: {
                        last_monitoring: Date.now()
                    }
                }]
            }
        });
    }

    async test_s3_resource(nsr) {
        let conn = this.nsr_connections_obj[nsr._id];
        if (!conn) {
            const { endpoint, access_key, secret_key } = nsr.connection;
            conn = new AWS.S3({
                endpoint: endpoint,
                credentials: {
                    accessKeyId: access_key.unwrap(),
                    secretAccessKey: secret_key.unwrap()
                },
                s3ForcePathStyle: true,
                sslEnabled: false
            });
            this.nsr_connections_obj[nsr._id] = conn;
        }

        const { target_bucket } = nsr.connection;
        const block_key = `test-delete-non-existing-key-${Date.now()}`;

        try {
            await conn.deleteObjectTagging({
                Bucket: target_bucket,
                Key: block_key
            }).promise();
        } catch (err) {
            if (err.code === 'AccessDenied' && nsr.is_readonly_namespace()) {
                return;
            }
            dbg.log1('test_s3_resource: got error:', err);
            if (err.code !== 'NoSuchKey') throw err;
        }

    }

    async test_blob_resource(nsr) {
        let conn = this.nsr_connections_obj[nsr._id];
        if (!conn) {
            const { endpoint, access_key, secret_key } = nsr.connection;
            const conn_string = cloud_utils.get_azure_new_connection_string({
                endpoint,
                access_key: access_key,
                secret_key: secret_key
            });
            conn = azure_storage.BlobServiceClient.fromConnectionString(conn_string);
            if (conn) this.nsr_connections_obj[nsr._id] = conn;
        }
        const { target_bucket } = nsr.connection;
        const block_key = `test-delete-non-existing-key-${Date.now()}`;

        try {
            const container_client = conn.getContainerClient(target_bucket);
            await container_client.deleteBlob(block_key);
        } catch (err) {
            if (err.code === 'InsufficientAccountPermissions' && nsr.is_readonly_namespace()) {
                return;
            }
            dbg.log1('test_blob_resource: got error:', err);
            if (err.code !== 'BlobNotFound') throw err;
        }
    }

    async test_nsfs_resource(nsr) {
        try {
            const fs_context = {
                backend: nsr.nsfs_config.fs_backend || '',
                warn_threshold_ms: config.NSFS_WARN_THRESHOLD_MS,
            };
            await nb_native().fs.readdir(fs_context, nsr.nsfs_config.fs_root_path);
            const stat = await nb_native().fs.stat(fs_context, nsr.nsfs_config.fs_root_path);
            //In the event of deleting the nsr.nsfs_config.fs_root_path in the FS side, 
            // The number of link will be 0, then we will throw ENOENT which translate to STORAGE_NOT_EXIST
            if (stat.nlink === 0) {
                throw Object.assign(new Error('FS root path has no links'), { code: 'ENOENT' });
            }
        } catch (err) {
            dbg.log1('test_nsfs_resource: got error:', err, nsr.nsfs_config);
            throw err;
        }
    }
}

exports.NamespaceMonitor = NamespaceMonitor;
