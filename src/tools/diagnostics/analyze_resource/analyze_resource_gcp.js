/* Copyright (C) 2023 NooBaa */
'use strict';

const { inspect } = require('util');
const { Storage } = require('@google-cloud/storage');
const dbg = require('../../../util/debug_module')(__filename);
dbg.set_process_name('analyze_resource');
const CloudVendor = require('./analyze_resource_cloud_vendor_abstract');

/**
 * @typedef {{
 *      private_key_json: JSON, 
 * }} AnalyzeGcpSpec
 */

class AnalyzeGcp extends CloudVendor {

    constructor(private_key_json) {
        super(); // Constructors for derived classes must contain a 'super' call.
        const gcs_params = {
            keyFilename: private_key_json,
        };
        this.gcs = new Storage(gcs_params);
    }

    async list_objects(bucket) {
        const options = {
            maxResults: CloudVendor.MAX_KEYS,
        };
        dbg.log0(`Calling GCP bucket(${bucket}).getFiles`);
        const [files] = await this.gcs
            .bucket(bucket)
            .getFiles(options);
        dbg.log0(`List object response: ${inspect(files)}`);

        this.file = '';
        if (files && files.length > 0) {
            this.file = files[0].name;
        }
    }

    async get_key() {
        return this.file;
    }

    async head_object(bucket, key) {
        dbg.log0(`Calling GCP bucket(${bucket}).file(${key}).getMetadata`);
        const [metadata] = await this.gcs
            .bucket(bucket)
            .file(key)
            .getMetadata();
        dbg.log0(`Head of ${key} response: ${inspect(metadata)}`);
    }

    async write_object(bucket, key) {
        dbg.log0(`Calling GCP bucket(${bucket}).file(${key}).createWriteStream`);
        const stream = await this.gcs
            .bucket(bucket)
            .file(key)
            .createWriteStream();
        stream.write(''); //write an empty file
        stream.end();
        stream.on('response', resp => {
            dbg.log0(`Write of ${key} response: ${inspect(resp)}`);
        });
    }

    async delete_object(bucket, key) {
        dbg.log0(`Calling GCP bucket(${bucket}).file(${key}).delete`);
        await this.gcs
            .bucket(bucket)
            .file(key)
            .delete();
        dbg.log0(`Delete of ${key} done`);
    }
}

// EXPORTS
module.exports = AnalyzeGcp;
