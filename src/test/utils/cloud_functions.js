/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');

class CloudFunction {

    constructor(client, report) {
        this._client = client;
        this._report = report;
    }

    async report_success(params) {
        if (this._report) {
            await this._report.success(params);
        }
    }

    async report_fail(params) {
        if (this._report) {
            await this._report.fail(params);
        }
    }

    async createCloudPool(connection, name, target_bucket) {
        console.log('Creating cloud pool ' + connection);
        try {
            await this._client.pool.create_cloud_pool({
                connection,
                name,
                target_bucket
            });
            await this.report_success(`Create_Cloud_Pool_${connection}`);
        } catch (err) {
            await this.report_fail(`Create_Cloud_Pool_${connection}`);
            throw new Error('Failed to create cloud pool ', err);
        }
    }

    async deleteCloudPool(pool) {
        console.log('Deleting cloud pool ' + pool);
        try {
            await this._client.pool.delete_pool({
                name: pool
            });
            await this.report_success(`Delete_Cloud_Pool_${pool}`);
        } catch (err) {
            await this.report_fail(`Delete_Cloud_Pool_${pool}`);
            throw new Error(`Failed to delete cloud pool error`, err);
        }
    }

    async waitingForHealthyPool(poolName) {
        console.log('Waiting for pool getting healthy');
        for (let retries = 36; retries >= 0; --retries) {
            try {
                if (retries === 0) {
                    throw new Error('Failed to get healthy status');
                } else {
                    const system_info = await this._client.system.read_system({});
                    let poolIndex = system_info.pools.findIndex(pool => pool.name === 'cloud-resource-aws');
                    let status = system_info.pools[poolIndex].mode;
                    if (system_info.pools[poolIndex].mode === 'OPTIMAL') {
                        console.log('Pool ' + poolName + ' is healthy');
                        break;
                    } else {
                        console.log('Pool ' + poolName + ' has status ' + status + ' waiting for OPTIMAL extra 5 seconds');
                        await P.delay(5 * 1000);
                    }
                }
            } catch (e) {
                console.log('something went wrong:', e);
            }
        }
    }

    async createConnection(connetction, type) {
        console.log(`Creating ${type} connection`);
        try {
            await this._client.account.add_external_connection(connetction);
            await this.report_success(`Create_Connection_${type}`);
        } catch (err) {
            await this.report_fail(`Create_Connection_${type}`);
            throw new Error('Failed to cretae connection ', err);
        }
    }

    async deleteConnection(connection_name) {
        console.log('Deleting connection ' + connection_name);
        try {
            await this._client.account.delete_external_connection({
                connection_name
            });
            await this.report_success(`Delete_Connection_${connection_name}`);
        } catch (err) {
            await this.report_fail(`Delete_Connection_${connection_name}`);
            throw new Error('Failed to delete connection ', err);
        }
    }

    async createNamespaceResource(connection, name, target_bucket) {
        console.log('Creating namespace resource with connection ' + connection);
        try {
            await this._client.pool.create_namespace_resource({
                connection,
                name,
                target_bucket
            });
            await this.report_success(`Create_Namespace_Resource_${connection}`);
        } catch (err) {
            await this.report_fail(`Create_Namespace_Resource_${connection}`);
            throw new Error('Failed to create namespace resource ', err);
        }
    }

    async deleteNamespaceResource(namespace) {
        console.log('Deleting cloud pool ' + namespace);
        try {
            await this._client.pool.delete_namespace_resource({
                name: namespace
            });
            await this.report_success(`Delete_Namespace_Resource_${namespace}`);
        } catch (err) {
            await this.report_fail(`Delete_Namespace_Resource_${namespace}`);
            throw new Error(`Failed to delete cloud pool error`, err);
        }
    }
}

exports.CloudFunction = CloudFunction;
