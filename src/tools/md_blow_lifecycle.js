/* Copyright (C) 2025 NooBaa */
'use strict';

const _ = require('lodash');
const mongodb = require('mongodb');
const argvParse = require('minimist');
const P = require('../util/promise');
const api = require('../api');
const { make_auth_token } = require('../server/common_services/auth_server');
const dbg = require('../util/debug_module')(__filename);
const system_store = require('../server/system_services/system_store').get_instance({ standalone: true });
const MDStore = require('../server/object_services/md_store').MDStore;

const rpc = api.new_rpc();
const client = rpc.new_client();

const argv = argvParse(process.argv, {
    string: ['email', 'password'],
});

argv.email = argv.email || 'admin@noobaa.io';
argv.password = argv.password || 'DeMo1';
argv.system = argv.system || 'noobaa';

function thisOrThat(_this, that) { return _.isUndefined(_this) ? that : _this; }

// Multipart arguments
argv.blow_multipart_objects = thisOrThat(argv.blow_multipart_objects, true);
argv.bucket = argv.bucket || 'first.bucket';
argv.count = argv.count || 100;
argv.chunks = argv.chunks || 128;
argv.chunk_size = argv.chunk_size || 1024 * 1024;
argv.concur = argv.concur || 1;
argv.key = argv.key || ('md_multipart_blow-' + Date.now().toString(36));
//argv.pool = argv.pool || 'noobaa-default-backing-store';
argv.multipart_age = argv.multipart_age || 0;
argv.num = argv.num || 1;
argv.size = argv.size || 8388608;
argv.md5_b64 = argv.md5_b64 || 's3VU2/tNjxI2s3ROF7sfFA==';
argv.sha256_b64 = argv.sha256_b64 || 'bla';
argv.num_parts = argv.num_parts || 1;

// Version arguments
argv.blow_version_objects = thisOrThat(argv.blow_version_objects, true);
argv.version_key = argv.version_key || ('md_version_blow-' + Date.now().toString(36));
argv.version_age = argv.version_age || 30;
argv.version_count = argv.version_count || 12;

// Delete matker arguments
argv.blow_expired_delete_marker = thisOrThat(argv.blow_expired_delete_marker, true);
argv.delete_marker_key = argv.delete_marker_key || ('md_delete_marker-' + Date.now().toString(36));
argv.delete_marker_count = argv.delete_marker_count || 12;
argv.delete_marker_age = argv.delete_marker_age || 30;

main();

async function main() {
    try {
        await system_store.load();
        try {
            await client.system.create_system({
            name: argv.system,
            email: argv.email,
            password: argv.password,
        });
        } catch (err) {
            dbg.error(`md_blow_multipart: create_system: System ${argv.system} already exists, Skipping....`, err);
        }
        const auth_params = {
            email: argv.email,
            role: 'admin',
            system: argv.system,
        };
        client.options.auth_token = make_auth_token(auth_params);
        try {
            await client.bucket.create_bucket({ name: argv.bucket });
        } catch (err) {
            dbg.error(`md_blow_multipart: blow_multipart_object: bucket ${argv.bucket} creation failed/exists with error, Skipping....`, err);
        }
        if (argv.blow_multipart_objects) {
            dbg.log0("<< ----------------- Start blow multipart object ------------------ >>");
            await blow_multipart_objects();
            dbg.log0("<< ----------------- End blow multipart object -------------------- >>");
        }
        if (argv.blow_version_objects) {
            dbg.log0("<< ----------------- Start blow version objects -------------------- >>");
            await blow_version_objects();
            dbg.log0("<< ----------------- End blow version objects ---------------  ----- >>");
        }
        if (argv.blow_expired_delete_marker) {
            dbg.log0("<< ----------------- Start blow expired delete marker --------------- >>");
            await blow_expired_delete_marker();
            dbg.log0("<< ----------------- End blow expired delete marker ----------------- >>");
        }
        process.exit(0);
    } catch (err) {
        dbg.error('md_blow_multipart: Failed with error,', err);
        process.exit(1);
    }
}

async function blow_expired_delete_marker() {
    client.bucket.update_bucket({
        name: argv.bucket,
        versioning: 'ENABLED'
    });
    //const obj_upload_ids = [];
    const content_type = 'application/octet_stream';
    const { obj_id } = await client.object.create_object_upload({ bucket: argv.bucket, key: argv.delete_marker_key, content_type });
    const obj_resp = await client.object.complete_object_upload({ obj_id, bucket: argv.bucket, key: argv.delete_marker_key });
    // this will delete the object and create the delete marker
    const resp = await client.object.delete_object({ bucket: argv.bucket, key: argv.delete_marker_key});
    console.log('blow_expired_delete_marker : delete_object response ', resp);
    // this will remove the noncurrent version from and create an expired object delete markers 
    const resp1 = await client.object.delete_object({ bucket: argv.bucket, key: argv.delete_marker_key, version_id: obj_resp.version_id});
    console.log('blow_expired_delete_marker : delete_object version response ', resp1);
}

async function blow_version_objects() {
    client.bucket.update_bucket({
        name: argv.bucket,
        versioning: 'ENABLED'
    });
    const obj_upload_ids = [];
    for (let i = 0; i < argv.version_count; ++i) {
        const content_type = 'application/octet_stream';
        const { obj_id } = await client.object.create_object_upload({ bucket: argv.bucket, key: argv.version_key, content_type });
        await client.object.complete_object_upload({ obj_id, bucket: argv.bucket, key: argv.version_key });
        if (i < argv.version_count - 2) {
            obj_upload_ids.push(new mongodb.ObjectId(obj_id));
        }
    }

    // go back in time
    if (argv.version_age > 0) {
        const create_time = new Date();
        create_time.setDate(create_time.getDate() - argv.version_age);
        const update = {
            create_time,
        };
        console.log('blow_version_objects: bucket', argv.bucket, 'multiparts_ids', obj_upload_ids, " obj_upload_ids length: ", obj_upload_ids.length, "update :", update);
        const update_result = await MDStore.instance().update_objects_by_ids(obj_upload_ids, update);
        console.log('blow_version_objects: update_objects_by_ids', update_result);
    }
}

async function blow_multipart_objects() {
    let index = 0;
    async function blow_multipart_serial() {
        while (index < argv.count) {
            index += 1;
            await blow_multipart_object(index);
        }
    }
    await P.all(_.times(argv.concur, blow_multipart_serial));
}

async function blow_multipart_object(index) {

    const obj_params = {
        bucket: argv.bucket,
        key: argv.key + '-' + index,
        size: argv.chunks * argv.chunk_size,
        content_type: 'application/octet_stream'
    };

    dbg.log0('create_object_upload', obj_params.key);
    const create_object_reply = await client.object.create_object_upload(obj_params);

    const params = {
        bucket: argv.bucket,
        key: argv.key + '-' + index,
        num: argv.num,
        size: argv.size,
        md5_b64: argv.md5_b64,
        sha256_b64: argv.sha256_b64,
    };
    params.obj_id = create_object_reply.obj_id;
    dbg.log0('create_multipart', params.obj_id);
    const create_reply = await client.object.create_multipart(params);

    const complete_params = _.pick(params, 'bucket', 'key', 'obj_id', 'num', 'size', 'md5_b64', 'sha256_b64', 'num_parts');
    complete_params.multipart_id = create_reply.multipart_id;
    complete_params.num_parts = argv.num_parts;
    dbg.log0('complete_multipart', params.id);
    const part_complete = await client.object.complete_multipart(complete_params);
    const complete_object_upload_params = { ...params, multiparts: [{ etag: part_complete.etag, num: 1 }] };
    delete complete_object_upload_params.num;
    // delete complete_object_upload_params.size;
    // delete complete_object_upload_params.md5_b64;
    // delete complete_object_upload_params.sha256_b64;
    await client.object.complete_object_upload(complete_object_upload_params);

    // go back in time
    if (argv.multipart_age > 0) {
        const create_time = new Date();
        create_time.setDate(create_time.getDate() - argv.multipart_age);
        const update = {
            create_time,
        };
        console.log('create_mock_multipart_upload bucket', argv.bucket, 'obj_id', params.obj_id, 'multiparts_ids', complete_params.multipart_id);
        const update_result = await MDStore.instance().update_multipart_by_id(new mongodb.ObjectId(complete_params.multipart_id), update);
        console.log('update_multiparts_by_ids', update_result);
    }

    const mp_list_after = await client.object.list_multiparts({ obj_id: params.obj_id, bucket: argv.bucket, key: obj_params.key });
    console.log("list_multiparts : ", mp_list_after);
}
