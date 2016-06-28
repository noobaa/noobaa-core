/**
 *
 * BLOCK STORE S3
 *
 * block store which uses s3 cloud storage
 *
 */
'use strict';

const _ = require('lodash');
const AWS = require('aws-sdk');
const path = require('path');
const https = require('https');

const P = require('../util/promise');
const dbg = require('../util/debug_module')(__filename);
const BlockStoreBase = require('./block_store_base').BlockStoreBase;

const https_agent = new https.Agent({
    rejectUnauthorized: false,
});

class BlockStoreS3 extends BlockStoreBase {

    constructor(options) {
        super(options);
        this.cloud_info = options.cloud_info;
        this.blocks_path = this.cloud_info.blocks_path || 'noobaa_blocks';

        // upload copy to s3 cloud storage.
        if (this.cloud_info.endpoint === 'https://s3.amazonaws.com') {
            this.s3cloud = new AWS.S3({
                endpoint: this.cloud_info.endpoint,
                accessKeyId: this.cloud_info.access_keys.access_key,
                secretAccessKey: this.cloud_info.access_keys.secret_key,
                region: 'us-east-1'
            });
        } else {
            this.s3cloud = new AWS.S3({
                endpoint: this.cloud_info.endpoint,
                s3ForcePathStyle: true,
                accessKeyId: this.cloud_info.access_keys.access_key,
                secretAccessKey: this.cloud_info.access_keys.secret_key,
                httpOptions: {
                    agent: https_agent
                }
            });
        }
    }

    get_storage_info() {
        const PETABYTE = 1024 * 1024 * 1024 * 1024 * 1024;
        return {
            total: PETABYTE,
            free: PETABYTE,
            used: 0,
        };
    }

    _read_block(block_md) {
        return P.ninvoke(this.s3cloud, 'getObject', {
                Bucket: this.cloud_info.target_bucket,
                Key: this._block_key(block_md.id),
            })
            .then(data => {
                return {
                    data: data.Body,
                    block_md: this._decode_block_md(data.Metadata.noobaa_block_md)
                };
            })
            .catch(err => {
                if (this._try_change_region(err)) {
                    return this._read_block(block_md);
                }
                dbg.error('_read_block failed:', err, this.cloud_info);
                throw err;
            });
    }

    _write_block(block_md, data) {
        return P.ninvoke(this.s3cloud, 'putObject', {
                Bucket: this.cloud_info.target_bucket,
                Key: this._block_key(block_md.id),
                Metadata: {
                    noobaa_block_md: this._encode_block_md(block_md)
                },
                Body: data
            })
            .catch(err => {
                if (this._try_change_region(err)) {
                    return this._write_block(block_md, data);
                }
                dbg.error('_write_block failed:', err, this.cloud_info);
                throw err;
            });
    }

    _delete_blocks(block_ids) {
        return P.ninvoke(this.s3cloud, 'deleteObjects', {
                Bucket: this.cloud_info.target_bucket,
                Delete: {
                    Objects: _.map(block_ids, block_id => ({
                        Key: this._block_key(block_id)
                    }))
                }
            })
            .catch(err => {
                if (this._try_change_region(err)) {
                    return this._delete_blocks(block_ids);
                }
                dbg.error('_delete_blocks failed:', err, this.cloud_info);
                throw err;
            });
    }


    _block_key(block_id) {
        return path.join(this.blocks_path, block_id);
    }

    _encode_block_md(block_md) {
        return new Buffer(JSON.stringify(block_md)).toString('base64');
    }

    _decode_block_md(noobaa_block_md) {
        return JSON.parse(new Buffer(noobaa_block_md, 'base64'));
    }

    _try_change_region(err) {
        // try to change default region from US to EU
        // due to restricted signature of v4 and end point
        if ((err.statusCode === 400 || err.statusCode === 301) &&
            this.s3cloud.config.signatureVersion !== 'v4') {
            dbg.log0('Resetting signature type and region to eu-central-1 and v4');
            this.s3cloud.config.signatureVersion = 'v4';
            this.s3cloud.config.region = 'eu-central-1';
            return true;
        }
        return false;
    }

}

// EXPORTS
exports.BlockStoreS3 = BlockStoreS3;
