/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const P = require('../../util/promise');
const dbg = require('../../util/debug_module')(__filename);
const MDStore = require('../object_services/md_store').MDStore;
const system_store = require('../system_services/system_store').get_instance();
var AWS = require('aws-sdk');
const auth_server = require('../common_services/auth_server');
const system_utils = require('../utils/system_utils');


class CachePrefetcher {
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
        return this.run_cache_prefetcher();
    }

    async run_cache_prefetcher() {

        const prefetched_buckets = this._get_cached_prefetched_buckets();
        await P.all(prefetched_buckets.map(async bucket => {

            const bucket_name = bucket.name.unwrap();
            const read_resources = bucket.bucket_info.namespace.read_resources;
            const write_resource = bucket.bucket_info.namespace.write_resource;
            const read_resource = read_resources.filter(rr => rr._id.toString() !== write_resource._id.toString())[0];
            const connection = read_resource.connection;
            const read_target_bucket = connection.target_bucket;
            const write_target_bucket = write_resource.connection.target_bucket;
            dbg.log0(`connecting to:  ${connection}`);

            // list objects directly from the read resource (Data lake)
            const s3_endpoint_aws = new AWS.S3({
                endpoint: connection.endpoint,
                accessKeyId: connection.access_key.unwrap(),
                secretAccessKey: connection.secret_key.unwrap(),
                s3ForcePathStyle: true,
                sslEnabled: false,
                s3DisableBodySigning: true,
            });
            const objs = await s3_endpoint_aws.listObjects({
                Bucket: connection.target_bucket,
                Prefix: bucket.prefix
            }).promise();

            const objs_arr = objs.Contents
            dbg.log0(`list of prefixed objects in namespace bucket: ${bucket_name}, ${objs_arr}`);

            // copy all objects from data lake (read resource) to the write resource
            await P.all(objs_arr.map(async object => {
                dbg.log0(`Moving object :${object.Key} to AWS :`);
                await s3_endpoint_aws.copyObject({
                    Bucket: write_target_bucket,
                    CopySource: `/${read_target_bucket}/${object.Key}`,
                    Key: object.Key
                }).promise();
            }));

            dbg.log0(`finished copying from data lake: ${bucket_name}`);

            // Store fetched = true in db not to fetch bucket it again
            const read_resources_ids = bucket.bucket_info.namespace.read_resources.map(rr => rr.name);
            const write_resource_id = bucket.bucket_info.namespace.write_resource.name;
            const new_namespace = {
                read_resources: read_resources_ids,
                write_resource: write_resource_id,
                caching: {
                    ttl_ms: bucket.ttl_ms,
                    fetched: true
                }
            };
            await this.client.bucket.update_bucket({ name: bucket_name, namespace: new_namespace }, {
                auth_token: this.auth_token
            });
            dbg.log0('Finished_updating fetched namespace bucket');
        }));
    }

    _get_cached_prefetched_buckets() {
        // return buckets that are namespace buckets and have caching and prefix and not fetched yet
        return system_store.data.buckets
            .filter(bucket =>
                _.isUndefined(bucket.deleting) && bucket.namespace && bucket.namespace.caching && bucket.namespace.caching.fetched === false &&
                bucket.namespace.caching.prefix).map(bucket => ({
                name: bucket.name,
                _id: MDStore.instance().make_md_id(bucket._id),
                prefix: bucket.namespace.caching.prefix,
                ttl_ms: bucket.namespace.caching.ttl_ms,
                bucket_info: bucket
            }));
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
}

// EXPORTS
exports.CachePrefetcher = CachePrefetcher;
