/* Copyright (C) 2016 NooBaa */
'use strict';

const system_store = require('../system_services/system_store').get_instance();
//TODO: why do we what to use the wrap and not directly @google-cloud/storage ? 
const GoogleCloudStorage = require('../../util/google_storage_wrap');
const azure_storage = require('../../util/azure_storage_wrap');
const auth_server = require('../common_services/auth_server');
const dbg = require('../../util/debug_module')(__filename);
const system_utils = require('../utils/system_utils');
const cloud_utils = require('../../util/cloud_utils');
const nb_native = require('../../util/nb_native');
const config = require('../../../config');
const P = require('../../util/promise');
const noobaa_s3_client = require('../../sdk/noobaa_s3_client/noobaa_s3_client');
const S3Error = require('../../endpoint/s3/s3_errors').S3Error;

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
                } else if (endpoint_type === 'GOOGLE') {
                    await this.test_gcs_resource(nsr);
                } else {
                    dbg.error('namespace_monitor: invalid endpoint type', endpoint_type);
                }
                this.update_last_monitoring(nsr._id, nsr.name, endpoint_type);
            } catch (err) {
                this.run_update_issues_report(err, nsr);
                dbg.log1(`test_namespace_resource_validity: namespace resource ${nsr.name} has an unexpected error`);
            }
        });
        dbg.log1(`test_namespace_resource_validity finished successfully..`);
    }

    run_update_issues_report(err, nsr) {
        if (!err.code) return;
        this.client.pool.update_issues_report({
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

    update_last_monitoring(nsr_id, nsr_name, endpoint_type) {
        dbg.log0(`update_last_monitoring: monitoring namespace ${nsr_name} type ${endpoint_type}, ${nsr_id} finished successfully..`);
        this.client.pool.update_last_monitoring({
            namespace_resource_id: nsr_id,
            last_monitoring: Date.now(),
        }, {
            auth_token: auth_server.make_auth_token({
                system_id: system_store.data.systems[0]._id,
                account_id: system_store.data.systems[0].owner._id,
                role: 'admin'
            })
        });
    }

    async test_s3_resource(nsr) {
        let conn = this.nsr_connections_obj[nsr._id];
        if (!conn) {
            const { endpoint, access_key, secret_key, auth_method, region } = nsr.connection;

            const params = {
                credentials: {
                    accessKeyId: access_key.unwrap(),
                    secretAccessKey: secret_key.unwrap(),
                },
                endpoint: endpoint,
                region: region ?? config.DEFAULT_REGION,
                forcePathStyle: true,
                tls: false,
                signatureVersion: cloud_utils.get_s3_endpoint_signature_ver(endpoint, auth_method),
                requestHandler: noobaa_s3_client.get_requestHandler_with_suitable_agent(endpoint),
            };
            conn = noobaa_s3_client.get_s3_client_v3_params(params);
            this.nsr_connections_obj[nsr._id] = conn;
        }

        const { target_bucket } = nsr.connection;
        const block_key = `test-delete-non-existing-s3-key-${Date.now()}`;

        try {
            await conn.deleteObjectTagging({
                Bucket: target_bucket,
                Key: block_key
            });
        } catch (err) {
            noobaa_s3_client.fix_error_object(err);
            if (err.code === 'AccessDenied' && nsr.is_readonly_namespace()) {
                return;
            }
            dbg.log1(`test_s3_resource: on bucket ${target_bucket} got error:`, err);
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
        const block_key = `test-delete-non-existing-blob-key-${Date.now()}`;

        try {
            const container_client = conn.getContainerClient(target_bucket);
            await container_client.deleteBlob(block_key);
        } catch (err) {
            if (err.code === 'InsufficientAccountPermissions' && nsr.is_readonly_namespace()) {
                return;
            }
            dbg.log1(`test_blob_resource: on bucket ${target_bucket} got error:`, err);
            if (err.code !== 'BlobNotFound') throw err;
        }
    }

    async test_gcs_resource(nsr) {
        let conn = this.nsr_connections_obj[nsr._id];
        if (!conn) {
            const { project_id, private_key, client_email } = JSON.parse(nsr.connection.secret_key.unwrap());
            conn = new GoogleCloudStorage({
                projectId: project_id,
                credentials: {
                    client_email,
                    private_key,
                }
            });
            this.nsr_connections_obj[nsr._id] = conn;
        }
        const { target_bucket } = nsr.connection;
        const block_key = `test-delete-non-existing-gcs-key-${Date.now()}`;
        try {
            await conn.bucket(target_bucket).file(block_key).delete();
        } catch (err) {
            if (err.errors[0].reason === 'UserProjectAccessDenied' && nsr.is_readonly_namespace()) {
                return;
            }
            dbg.log1(`test_gcs_resource: on bucket ${target_bucket} got error:`, err);
            // https://cloud.google.com/storage/docs/json_api/v1/status-codes
            if (err.errors[0].reason !== 'notFound') throw err;
        }
    }

    // In test_nsfs_resource we check readdir and stat - 
    // readdir checks read permissions and in the past stat didn't check read permissions.
    // Nowadays stat also checks read permissions so now readdir is redundant - decided to keep it.
    async test_nsfs_resource(nsr) {
        dbg.log1('test_nsfs_resource: (name, namespace_store, nsfs_config):',
            nsr.name, nsr.namespace_store, nsr.nsfs_config);
        try {
            const fs_context = {
                backend: nsr.nsfs_config.fs_backend || '',
                warn_threshold_ms: config.NSFS_WARN_THRESHOLD_MS,
            };
            await nb_native().fs.readdir(fs_context, nsr.nsfs_config.fs_root_path);
            const stat = await nb_native().fs.stat(fs_context, nsr.nsfs_config.fs_root_path);
            //In the event of deleting the nsr.nsfs_config.fs_root_path in the FS side, 
            // The number of link will be 0, then we will throw an error which translate to STORAGE_NOT_EXIST
            if (stat.nlink === 0) {
                dbg.log1('test_nsfs_resource: the number of links is 0', nsr.nsfs_config);
                throw Object.assign(new Error('FS root path has no links'), { code: 'ENOENT' });
            }
        } catch (err) {
            dbg.error('test_nsfs_resource: got error:', err, nsr.nsfs_config);
            // we change the code to control the mapping in pool server when calc the namespace mode
            if (err.code === 'ENOENT') {
                // it can happen if (1) stat/readdir threw ENOENT or (2) the number of links is 0 
                throw Object.assign(err, { code: S3Error.NoSuchBucket.code });
            }
            if (err.code === `EPERM` || err.code === `EACCES`) {
                throw Object.assign(err, { code: S3Error.AccessDenied.code });
            }
            throw err;
        }
    }
}

exports.NamespaceMonitor = NamespaceMonitor;
