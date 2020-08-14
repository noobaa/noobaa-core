/* Copyright (C) 2016 NooBaa */
'use strict';

const _ = require('lodash');
const range_utils = require('../../util/range_utils');

class ObjectAPIFunctions {

    constructor(client) {
        this._client = client;
    }

    async getObjectMD(params) {
        const { bucket, key } = params;
        try {
            const md = await this._client.object.read_object_md({
                key,
                bucket
            });

            console.log('Got object noobaa md', md);
            return md;
        } catch (e) {
            console.error('Failed to read object noobaa md', e);
            throw e;
        }
    }

    async getObjectMDPartsInfo(params) {
        const md = await this.getObjectMD(params);
        params.obj_id = md.obj_id;
        const object_mapping = await this._client.object.read_object_mapping(params);
        const parts = [];
        for (const chunk of object_mapping.chunks) {
            for (const part of chunk.parts) {
                parts.push(part);
            }
        }
        parts.sort((p1, p2) => p1.start - p2.start);
        const num_parts = parts.length;
        const deduped_parts = range_utils.dedup_ranges(parts);
        const upload_size = _.sumBy(deduped_parts, part => part.end - part.start);

        md.num_parts = num_parts;
        md.upload_size = upload_size;
        console.log('Got object md and part info', params, md, parts);
        return md;
    }
}

exports.ObjectAPIFunctions = ObjectAPIFunctions;
