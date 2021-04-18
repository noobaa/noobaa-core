/* Copyright (C) 2016 NooBaa */
'use strict';

const system_store = require('../system_services/system_store').get_instance();
const azure_storage = require('../../util/azure_storage_wrap');
const auth_server = require('../common_services/auth_server');
const dbg = require('../../util/debug_module')(__filename);
const system_utils = require('../utils/system_utils');
const cloud_utils = require('../../util/cloud_utils');
const config = require('../../../config');
const P = require('../../util/promise');
const AWS = require('aws-sdk');
const _ = require('lodash');

class NamespaceMonitor {

    constructor({ name, client}) {
        this.name = name;
        this.client = client;
        this.nsr_connections_obj = {};
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
            try {
                if (!this.nsr_connections_obj[nsr._id]) {
                    this.init_nsr_connection_to_target(nsr);
                }
                await this.test_single_namespace_resource_validity(nsr);

            } catch (err) {
                if (err.code !== 'BlobNotFound' && err.code !== 'NoSuchKey') {
                    const { endpoint, target_bucket } = nsr.connection;
                    dbg.error('test_namespace_resource_validity failed:', err, endpoint, target_bucket);

                    await this.client.pool.update_issues_report({
                        namespace_resource_id: nsr._id,
                        error_code: err.code,
                        time: Date.now(),
                        monitoring: true
                    }, {
                        auth_token: auth_server.make_auth_token({
                            system_id: system_store.data.systems[0]._id,
                            account_id: system_store.data.systems[0].owner._id,
                            role: 'admin'
                        })
                    });
                    dbg.warn(`unexpected error (code=${err.code}) from test_namespace_resource_validity during test. ignoring..`);
                }
                dbg.log1(`test_namespace_resource_validity: namespace resource ${nsr.name} has error as expected`);
            }
        });
        dbg.log1(`test_namespace_resource_validity finished successfuly..`);
    }

    init_nsr_connection_to_target(nsr) {
        if (nsr.nsfs_config) {
            return;
        }
        const {endpoint, access_key, secret_key} = nsr.connection;
        let conn;
        switch (nsr.connection.endpoint_type) {
            case 'AWS' || 'S3_COMPATIBLE' || 'IBM_COS': {
                conn = new AWS.S3({
                    endpoint: endpoint,
                    credentials: {
                        accessKeyId: access_key.unwrap(),
                        secretAccessKey: secret_key.unwrap()
                    },
                    s3ForcePathStyle: true,
                    sslEnabled: false
                });
                break;
            }
            case 'AZURE': {
                const conn_string = cloud_utils.get_azure_connection_string({
                    endpoint,
                    access_key: access_key,
                    secret_key: secret_key
                });
                conn = azure_storage.createBlobService(conn_string);
                break;
            }
            default:
                dbg.error('namespace_monitor: invalid endpoint type', nsr.endpoint_type);
        }
        if (conn) {
            this.nsr_connections_obj[nsr._id] = conn;
        }
    }

    async test_single_namespace_resource_validity(nsr_info) {
        if (nsr_info.nsfs_config) {
            dbg.log1('namespace_monitor: namespace resource of type FS, skipping validity test...');
            return;
        }
        const { endpoint_type, target_bucket} = nsr_info.connection;
        const block_key = `test-delete-non-existing-key-${Date.now()}`;
        const conn = this.nsr_connections_obj[nsr_info._id];

        if (_.includes(['AWS', 'S3_COMPATIBLE', 'IBM_COS'], endpoint_type)) {
            await conn.deleteObjectTagging({
                Bucket: target_bucket,
                Key: block_key
            }).promise();
        } else if (endpoint_type === 'AZURE') {
            await P.fromCallback(callback =>
                conn.deleteBlob(
                    target_bucket,
                    block_key,
                    callback)
            );
        } else {
            dbg.error('namespace_monitor: invalid endpoint type', endpoint_type);
        }
    }
}

exports.NamespaceMonitor = NamespaceMonitor;
