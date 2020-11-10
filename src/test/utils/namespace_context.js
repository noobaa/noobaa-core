/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const crypto = require('crypto');
const P = require('../../util/promise');
const { ObjectAPIFunctions } = require('../utils/object_api_functions');

//define colors
const BLUE = "\x1b[34;1m";
const YELLOW = "\x1b[33;1m";
const GREEN = "\x1b[32;1m";
const RED = "\x1b[31;1m";
const NC = "\x1b[0m";

const BASE_UNIT = 1024;
const unit_mapping = {
    KB: {
        data_multiplier: BASE_UNIT ** 1,
        dataset_multiplier: BASE_UNIT ** 2
    },
    MB: {
        data_multiplier: BASE_UNIT ** 2,
        dataset_multiplier: BASE_UNIT ** 1
    },
    GB: {
        data_multiplier: BASE_UNIT ** 3,
        dataset_multiplier: BASE_UNIT ** 0
    }
};

function mk_test_name(s, cloud_provider) {
    return `${s} (cloud provider: ${cloud_provider})`;
}

class NamespaceContext {

    constructor({ rpc_client, namespace_mapping, noobaa_s3ops, report, cache_ttl_ms, block_size }) {
        this._rpc_client = rpc_client;
        this._obj_functions = new ObjectAPIFunctions(rpc_client);
        this._report = report;
        this._files_cloud = { };
        this._ns_mapping = namespace_mapping;
        this._noobaa_s3ops = noobaa_s3ops;
        this.cache_ttl_ms = cache_ttl_ms;
        this.block_size = block_size;
        this.block_size_kb = block_size / 1024;
    }

    // file_name follows the pattern prefix_name_[0-9]+_[KB|MB|GB]
    _get_size_from_file_name(file_name) {
        const tokens = file_name.split('_');
        if (tokens.length < 2) {
            return { size: 1, data_multiplier: unit_mapping.KB.data_multiplier };
        } else {
            const { data_multiplier } = _.defaultTo(unit_mapping[_.last(tokens)], unit_mapping.KB);
            const size = _.toInteger(tokens[tokens.length - 2]);
            return { size: size === 0 ? 1 : size, data_multiplier };
        }
    }

    async get_via_noobaa_check_md5(type, file_name) {
        const noobaa_bucket = this._ns_mapping[type].gateway;
        await this._noobaa_s3ops.get_file_check_md5(noobaa_bucket, file_name);
    }

    async get_object_s3_md(s3ops_arg, bucket, file_name, get_from_cache, preconditions) {
        try {
            const ret = await s3ops_arg.get_object(bucket, file_name,
                get_from_cache ? { get_from_cache: true } : undefined, preconditions);
            return {
                md5: crypto.createHash('md5').update(ret.Body).digest('hex'),
                size: ret.Body.length,
                etag: _.trim(ret.ETag, '"'),
                last_modified_time: ret.LastModified,
            };
        } catch (err) {
            console.log(`Failed to get data from ${file_name} in ${bucket}: ${err}`);
            throw err;
        }
    }

    async get_via_cloud(type, file_name, preconditions) {
        const cloud_bucket = this._ns_mapping[type].bucket2;
        return this.get_object_s3_md(this._ns_mapping[type].s3ops, cloud_bucket, file_name, false, preconditions);
    }

    async get_via_noobaa(type, file_name, preconditions) {
        const noobaa_bucket = this._ns_mapping[type].gateway;
        return this.get_object_s3_md(this._noobaa_s3ops, noobaa_bucket, file_name, false, preconditions);
    }

    async get_size_etag(s3ops_arg, bucket, file_name) {
        return s3ops_arg.get_object_size_etag(bucket, file_name);
    }

    async get_size_etag_via_cloud(type, file_name) {
        const cloud_bucket = this._ns_mapping[type].bucket2;
        return this.get_size_etag(this._ns_mapping[type].s3ops, cloud_bucket, file_name);
    }

    async get_object_expect_not_found(s3ops_arg, bucket, file_name, get_from_cache) {
        try {
            const ret = await s3ops_arg.get_object(bucket, file_name, get_from_cache ? { get_from_cache: true } : undefined);
            throw new Error(`Expect ${file_name} not found in ${bucket}, but found with size: ${ret.ContentLength}`);
        } catch (err) {
            if (err.code === 'NoSuchKey') return true;
            throw err;
        }
    }

    async get_via_noobaa_expect_not_found(type, file_name, get_from_cache) {
        const noobaa_bucket = this._ns_mapping[type].gateway;
        await this.get_object_expect_not_found(this._noobaa_s3ops, noobaa_bucket, file_name, get_from_cache);
    }

    async get_via_cloud_expect_not_found(type, file_name) {
        const cloud_bucket = this._ns_mapping[type].bucket2;
        await this.get_object_expect_not_found(this._ns_mapping[type].s3ops, cloud_bucket, file_name);
    }

    async delete_from_noobaa(type, file_name) {
        try {
            const noobaa_bucket = this._ns_mapping[type].gateway;
            await this._noobaa_s3ops.delete_file(noobaa_bucket, file_name);
        } catch (err) {
            if (err.code === 'NoSuchKey') return true;
            throw err;
        }
    }

    async delete_from_cloud(type, file_name) {
        try {
            const cloud_bucket = this._ns_mapping[type].bucket2;
            await this._ns_mapping[type].s3ops.delete_file(cloud_bucket, file_name);
        } catch (err) {
            if (err.code === 'NoSuchKey') return true;
            throw err;
        }
    }

    async delete_files_from_noobaa(type, file_names) {
        const noobaa_bucket = this._ns_mapping[type].gateway;
        await this._noobaa_s3ops.delete_multiple_files(noobaa_bucket,
            _.map(file_names, filename => ({ filename })));
    }

    async expect_not_found_in_cache(type, file_name) {
        const noobaa_bucket = this._ns_mapping[type].gateway;
        console.log(`expecting cache md not found for ${file_name} in ${noobaa_bucket}`);
        await this.get_object_expect_not_found(this._noobaa_s3ops, noobaa_bucket, file_name, true);
    }

    async validate_cache_noobaa_md({ type, file_name, validation_params }) {
        const noobaa_bucket = this._ns_mapping[type].gateway;
        console.log(`validating noobaa cache md for ${file_name} in ${noobaa_bucket}`);
        const md = (!_.isUndefined(validation_params.num_parts) || !_.isUndefined(validation_params.upload_size)) ?
            await this._obj_functions.getObjectMDPartsInfo({ bucket: noobaa_bucket, key: file_name }) :
            await this._obj_functions.getObjectMD({ bucket: noobaa_bucket, key: file_name });
        const { cache_last_valid_time_range, num_parts, size, etag, upload_size } = validation_params;
        if (cache_last_valid_time_range) {
            if (cache_last_valid_time_range.end) {
                if (!_.inRange(md.cache_last_valid_time, cache_last_valid_time_range.start, cache_last_valid_time_range.end)) {
                    const msg = `expect it between ${cache_last_valid_time_range.start} and ${cache_last_valid_time_range.end}, but got ${md.cache_last_valid_time}`;
                    const err = new Error(`Unexpected cache_last_valid_time in object md ${file_name} in bucket ${noobaa_bucket}: ${msg}`);
                    err.name = 'UnexpectedValue';
                    throw err;
                }
            } else if (md.cache_last_valid_time <= cache_last_valid_time_range.start) {
                const msg = `expect it after ${cache_last_valid_time_range.start}, but got ${md.cache_last_valid_time}`;
                const err = new Error(`Unexpected cache_last_valid_time in object md ${file_name} in bucket ${noobaa_bucket}: ${msg}`);
                err.name = 'UnexpectedValue';
                throw err;
        }
        }
        for (const [k, v] of Object.entries({num_parts, size, etag, upload_size })) {
            if (!_.isUndefined(v)) {
                console.log(`validating ${k}: expect ${v} and have ${md[k]} in noobaa md`);
                if (v !== md[k]) {
                    const err = new Error(`Unexpected ${k} expect ${v} and have ${md[k]} in object md ${file_name} in bucket ${noobaa_bucket}`);
                    err.name = 'UnexpectedValue';
                    throw err;
                }
            }
        }
        console.log(`validation passed: noobaa cache md for ${file_name} in ${noobaa_bucket}`);
        return md;
    }

    async validate_md5_between_hub_and_cache({ type, force_cache_read, file_name, expect_same }) {
        console.log(`comparing md5 between noobaa cache bucket and ${type} bucket for ${file_name}`);
        const ns = this._ns_mapping[type];
        const cloud_bucket = this._ns_mapping[type].bucket2;
        const noobaa_bucket = this._ns_mapping[type].gateway;
        const cloud_md = await this.get_object_s3_md(ns.s3ops, cloud_bucket, file_name, false);
        const cloud_md5 = cloud_md.md5;
        const noobaa_md = await this.get_object_s3_md(this._noobaa_s3ops, noobaa_bucket, file_name, force_cache_read);
        const noobaa_md5 = noobaa_md.md5;
        console.log(`noobaa cache bucket (${noobaa_bucket}) has md5 ${
            noobaa_md5} and hub bucket ${cloud_bucket} has md5 ${cloud_md5} for ${file_name}`);
        console.log(`${file_name} size is ${cloud_md.size} on ${type} and ${noobaa_md.size} on noobaa`);

        if (expect_same && cloud_md5 !== noobaa_md5) {
            throw new Error(`Expect md5 ${noobaa_md5} in noobaa cache bucket (${noobaa_bucket}) is the same as md5 ${
                cloud_md5} in hub bucket ${cloud_bucket} for ${file_name}`);
        } else if (!expect_same && cloud_md5 === noobaa_md5) {
            throw new Error(`Expect md5 ${noobaa_md5} in noobaa cache bucket (${noobaa_bucket}) is different than md5 ${
                cloud_md5} in hub bucket ${cloud_bucket} for ${file_name}`);
        }

        if (expect_same && cloud_md.last_modified_time.getTime() !== noobaa_md.last_modified_time.getTime()) {
            throw new Error(`Expect last_modified_time (${noobaa_md.last_modified_time}) in noobaa cache bucket (${noobaa_bucket})
                is the same as last_modified_time (${cloud_md.last_modified_time}) in hub bucket ${cloud_bucket} for ${file_name}`);
        } else if (!expect_same && cloud_md.last_modified_time.getTime() === noobaa_md.last_modified_time.getTime()) {
            throw new Error(`Expect last_modified_time (${noobaa_md.last_modified_time}) in noobaa cache bucket (${noobaa_bucket})
                is different than last_modified_time (${cloud_md.last_modified_time}) in hub bucket ${cloud_bucket} for ${file_name}`);
        }

        console.log(`validation passed: noobaa cache bucket ${noobaa_bucket} and ${type} bucket have same md5 for ${file_name}`);
        return { cloud_md, noobaa_md };
    }

    // end is inclusive
    async get_range_md5_size(s3ops_arg, bucket, file_name, start, end, preconditions) {
        console.log(`${BLUE}reading range ${start}-${end} from ${file_name} on bucket ${bucket}${NC}`);
        try {
            const ret_body = await s3ops_arg.get_object_range(bucket, file_name, start, end, undefined, preconditions);
            return {
                md5: crypto.createHash('md5').update(ret_body).digest('hex'),
                size: ret_body.length
            };
        } catch (err) {
            console.log(`Failed to get range data from ${file_name} in ${bucket}: ${err}`);
            throw err;
        }
    }

    async get_range_md5_size_via_noobaa(type, file_name, start, end, preconditions) {
        const noobaa_bucket = this._ns_mapping[type].gateway;
        return this.get_range_md5_size(this._noobaa_s3ops, noobaa_bucket, file_name, start, end, preconditions);
    }

    async validate_md5_range_read_between_hub_and_cache({ type, file_name,
        start, end, expect_read_size, expect_same }) {

        console.log(`comparing noobaa cache bucket to ${type} bucket for range ${start}-${end} in ${file_name}`);
        const ns = this._ns_mapping[type];
        const cloud_bucket = this._ns_mapping[type].bucket2;
        const noobaa_bucket = this._ns_mapping[type].gateway;
        const cloud_md = await this.get_range_md5_size(ns.s3ops, cloud_bucket, file_name, start, end);
        const cloud_md5 = cloud_md.md5;
        const noobaa_md = await this.get_range_md5_size(this._noobaa_s3ops, noobaa_bucket, file_name, start, end);
        const noobaa_md5 = noobaa_md.md5;
        console.log(`noobaa cache bucket (${noobaa_bucket}) contains the md5 ${
            noobaa_md5} and hub bucket ${cloud_bucket} has md5 ${cloud_md5} for range ${start}-${end} in ${file_name}`);
        console.log(`${file_name}: read range size is ${cloud_md.size} on ${type} and ${noobaa_md.size} on noobaa`);

        if (expect_same) {
            if (cloud_md5 !== noobaa_md5) {
                throw new Error(`Expect md5 ${noobaa_md5} in noobaa cache bucket (${noobaa_bucket}) is the same as md5 ${
                    cloud_md5} in hub bucket ${cloud_bucket} for range ${start}-${end} in ${file_name}`);
            }
            if (expect_read_size !== noobaa_md.size) {
                throw new Error(`Expect range read size ${expect_read_size} on ${file_name} from noobaa cache bucket (${noobaa_bucket}) but got ${
                    noobaa_md.size} for read range ${start}-${end}`);
            }
        } else if (!expect_same && cloud_md5 === noobaa_md5) {
            throw new Error(`Expect md5 ${noobaa_md5} in noobaa cache bucket (${noobaa_bucket}) is different than md5 ${
                cloud_md5} in hub bucket ${cloud_bucket} for range ${start}-${end} in ${file_name}`);
        }

        console.log(`validation passed: noobaa cache bucket ${noobaa_bucket} and ${type} bucket ${cloud_bucket} have same md5 for range ${start}-${end} in ${file_name}`);
        return { cloud_md, noobaa_md };
    }

    async upload_via_noobaa_endpoint(type, file_name, bucket) {
        if (!file_name) {
            file_name = 'file_namespace_test_' + (Math.floor(Date.now() / 1000));
        }
        if (!bucket) {
            bucket = this._ns_mapping[type].gateway;
        }
        const { size, data_multiplier } = this._get_size_from_file_name(file_name);
        console.log(`uploading ${file_name} via noobaa bucket ${bucket}`);
        if (this._files_cloud[`files_${type}`]) {
            this._files_cloud[`files_${type}`].push(file_name);
        } else {
            this._files_cloud[`files_${type}`] = [ file_name ];
        }
        try {
            const md5 = await this._noobaa_s3ops.put_file_with_md5(bucket, file_name, size, data_multiplier);
            return { file_name, md5 };
        } catch (err) {
            throw new Error(`Failed upload ${file_name} ${err}`);
        }
    }

    async upload_directly_to_cloud(type, file_name) {
        if (!file_name) {
            file_name = 'file_namespace_test_' + (Math.floor(Date.now() / 1000));
        }
        const { size, data_multiplier } = this._get_size_from_file_name(file_name);
        const hub_bucket = this._ns_mapping[type].bucket2;
        console.log(`uploading ${file_name} directly to ${type} bucket ${hub_bucket}`);
        if (this._files_cloud[`files_${type}`]) {
            this._files_cloud[`files_${type}`].push(file_name);
        } else {
            this._files_cloud[`files_${type}`] = [ file_name ];
        }
        try {
            const md5 = await this._ns_mapping[type].s3ops.put_file_with_md5(hub_bucket, file_name, size, data_multiplier);
            return { file_name, md5 };
        } catch (err) {
            throw new Error(`Failed to upload directly into ${type} bucket ${hub_bucket}`);
        }
    }

    async list_files_in_cloud(type) {
        const list_files_obj = await this._ns_mapping[type].s3ops.get_list_files(this._ns_mapping[type].bucket2);
        return list_files_obj.map(file => file.Key);
    }

    async check_via_cloud(type, file_name) {
        console.log(`checking via ${type}: ${this._ns_mapping[type].bucket2}`);
        const list_files = await this.list_files_in_cloud(type);
        console.log(`${type} files list ${list_files}`);
        if (list_files.includes(file_name)) {
            console.log(`${file_name} was uploaded via noobaa and found via ${type}`);
        } else {
            throw new Error(`${file_name} was uploaded via noobaa and was not found via ${type}`);
        }
        return true;
    }

    async validate_range_read({ type, file_name, cloud_obj_md,
        start, end, cache_last_valid_time_range,
        expect_read_size, expect_num_parts, expect_upload_size}) {

        console.log(`validating range read ${start}-${end} in ${file_name}`);
        const mds = await this.validate_md5_range_read_between_hub_and_cache({
            type,
            file_name,
            start,
            end,
            expect_read_size,
            expect_same: true
        });

        if (!_.isUndefined(cache_last_valid_time_range) || !_.isUndefined(expect_num_parts) ||
            !_.isUndefined(expect_upload_size)) {
            await P.wait_until(async () => {
                try {
                    await this.validate_cache_noobaa_md({
                        type,
                        file_name,
                        validation_params: {
                            cache_last_valid_time_range,
                            size: cloud_obj_md.size,
                            etag: cloud_obj_md.etag,
                            num_parts: expect_num_parts,
                            upload_size: expect_upload_size,
                        }
                    });
                    return true;
                } catch (err) {
                    if (err.rpc_code === 'NO_SUCH_OBJECT') return false;
                    if (err.name === 'UnexpectedValue') return false;
                    throw err;
                }
            }, 10000);
        } else {
            await this.expect_not_found_in_cache(type, file_name);
        }
        console.log(`validation passed: range read ${start}-${end} in ${file_name}`);
        return mds;
    }

    async delay(delay_ms) {
        const _delay_ms = _.defaultTo(delay_ms, this.cache_ttl_ms + 1000);
        console.log(`${BLUE}waiting for ttl to expire in ${_delay_ms} ms......${NC}`);
        await P.delay(_delay_ms);
    }

    async run_test_case(test_desc, cloud_type, test_case_fn) {
        const test_name = mk_test_name(test_desc, cloud_type);
        console.log(`+++ ${YELLOW}running test case: ${test_name}${NC}`);
        try {
            await test_case_fn();
            console.log(`--- ${GREEN}test case passed: ${test_name}${NC}`);
            this._report.success(test_name);
        } catch (err) {
            console.log(`!!! ${RED}test case (${test_name}) failed${NC}: ${err}`);
            this._report.fail(test_name);
        }
    }

}

module.exports.NamespaceContext = NamespaceContext;
module.exports.mk_test_name = mk_test_name;
