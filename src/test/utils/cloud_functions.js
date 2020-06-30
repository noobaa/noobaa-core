/* Copyright (C) 2016 NooBaa */
'use strict';

const P = require('../../util/promise');

class CloudFunction {

    constructor(client) {
        this._client = client;
    }

    getAWSConnection() {
        const {
            AWS_ACCESS_KEY_ID,
            AWS_SECRET_ACCESS_KEY,
        } = process.env;
        const AWSConnections = {
            name: 'AWSConnection',
            endpoint: "https://s3.amazonaws.com",
            endpoint_type: "AWS",
            identity: AWS_ACCESS_KEY_ID,
            secret: AWS_SECRET_ACCESS_KEY
        };
        return AWSConnections;
    }

    getCOSConnection() {
        const {
            COS_ACCESS_KEY_ID,
            COS_SECRET_ACCESS_KEY,
        } = process.env;
        const COSConnections = {
            name: 'COSConnection',
            endpoint: "https://s3.us-south.cloud-object-storage.appdomain.cloud",
            endpoint_type: "IBM_COS",
            identity: COS_ACCESS_KEY_ID,
            secret: COS_SECRET_ACCESS_KEY
        };
        return COSConnections;
    }

    getAzureConnection() {
        const {
            AZURE_STORAGE_ACCOUNT_NAME,
            AZURE_STORAGE_ACCOUNT_KEY,
        } = process.env;

        const AzureConnection = {
            name: 'AZUREConnection',
            endpoint: 'https://blob.core.windows.net',
            endpoint_type: "AZURE",
            identity: AZURE_STORAGE_ACCOUNT_NAME,
            secret: AZURE_STORAGE_ACCOUNT_KEY
        };
        return AzureConnection;
    }

    async createCloudPool(connection, name, target_bucket) {
        console.log('Creating cloud pool ' + connection);
        try {
            await this._client.pool.create_cloud_pool({
                connection,
                name,
                target_bucket
            });
        } catch (e) {
            console.error('Failed to create cloud pool', e);
            throw e;
        }
    }

    async deleteCloudPool(pool) {
        console.log('Deleting cloud pool ' + pool);
        try {
            await this._client.pool.delete_pool({
                name: pool
            });
        } catch (e) {
            console.error('Failed to delete cloud pool error', e);
            throw e;
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

    async createConnection(connection, type) {
        console.log(`Creating ${type} connection`);
        await this._client.account.add_external_connection(connection);
    }

    async deleteConnection(connection_name) {
        console.log('Deleting connection ' + connection_name);
        try {
            await this._client.account.delete_external_connection({
                connection_name
            });
        } catch (e) {
            console.error('Failed to delete connection', e);
            throw e;
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
        } catch (e) {
            console.error('Failed to create namespace resource', e);
            throw e;
        }
    }

    async deleteNamespaceResource(namespace) {
        console.log('Deleting cloud pool ' + namespace);
        try {
            await this._client.pool.delete_namespace_resource({
                name: namespace
            });
        } catch (e) {
            console.error('Failed to delete cloud pool error', e);
            throw e;
        }
    }
}

exports.CloudFunction = CloudFunction;
