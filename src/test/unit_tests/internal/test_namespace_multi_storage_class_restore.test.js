/* Copyright (C) 2026 NooBaa */
'use strict';

const NamespaceMultiStorageClass = require('../../../sdk/namespace_multi_storage_class');
const s3_utils = require('../../../endpoint/s3/s3_utils');
const S3Error = require('../../../endpoint/s3/s3_errors').S3Error;
const { RpcError } = require('../../../rpc');
const { get_archive_key, compute_restore_expiry } = require('../../../util/deep_archive_utils');
const CONSTANTS = require('../../../common/constants');

const BUCKET = 'restore-it-bucket';
const BUCKET_ID = '507f1f77bcf86cd799439011';
const OBJ_ID = '507f1f77bcf86cd799439012';
const CLAIM_ID = '507f1f77bcf86cd799439013';
const KEY = 'archived/object';

/**
 * Builds MSC with mock metadata ns and archive ns for restore_object tests.
 * @param {{ object_restore_info?: object, archive_restore_impl?: Function }} [opts]
 */
function make_msc_fixture({ object_restore_info: object_restore_info_override, archive_restore_impl } = {}) {
    const object_restore_info = {
        obj_id: OBJ_ID,
        bucket_id: BUCKET_ID,
        key: KEY,
        storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
        ...object_restore_info_override,
    };

    // archive_restore_object stands in for whatever sits behind the archive namespacestore
    // (usually NamespaceS3).
    const archive_restore_object = jest.fn().mockImplementation(
        archive_restore_impl || (async () => ({ accepted: true }))
    );
    const get_object_restore_info = jest.fn().mockResolvedValue(object_restore_info);
    const update_restore_info = jest.fn().mockImplementation(async params => {
        if (params.restore_update_intent === CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.START) {
            return { cas_matched: true, restore_claim_id: CLAIM_ID };
        }
        return { cas_matched: true };
    });

    const metadata_ns = {};
    const archive_ns = { restore_object: archive_restore_object };
    const object_sdk = {
        internal_rpc_client: {
            object: { get_object_restore_info, update_restore_info },
        },
    };

    const ns_msc = new NamespaceMultiStorageClass({
        namespace_by_storage_class: {
            [s3_utils.STORAGE_CLASS_STANDARD]: metadata_ns,
            [s3_utils.STORAGE_CLASS_DEEP_ARCHIVE]: archive_ns,
            [s3_utils.STORAGE_CLASS_GLACIER]: archive_ns,
        },
    });

    return {
        ns_msc,
        object_restore_info,
        metadata_ns,
        archive_ns,
        object_sdk,
        get_object_restore_info,
        archive_restore_object,
        update_restore_info,
    };
}

function make_read_object_md_msc_fixture(object_md) {
    const read_object_md = jest.fn().mockResolvedValue(object_md);
    const metadata_ns = { read_object_md };
    const object_sdk = {};

    const ns_msc = new NamespaceMultiStorageClass({
        namespace_by_storage_class: {
            [s3_utils.STORAGE_CLASS_STANDARD]: metadata_ns,
            [s3_utils.STORAGE_CLASS_DEEP_ARCHIVE]: {},
        },
    });

    return { ns_msc, metadata_ns, read_object_md, object_sdk };
}

function make_list_objects_msc_fixture(objects) {
    const list_reply = {
        objects: Array.isArray(objects) ? objects : [objects],
        common_prefixes: [],
        is_truncated: false,
    };
    const list_objects = jest.fn().mockResolvedValue(list_reply);
    const metadata_ns = { list_objects };
    const object_sdk = {};

    const ns_msc = new NamespaceMultiStorageClass({
        namespace_by_storage_class: {
            [s3_utils.STORAGE_CLASS_STANDARD]: metadata_ns,
            [s3_utils.STORAGE_CLASS_DEEP_ARCHIVE]: {},
        },
    });

    return { ns_msc, metadata_ns, list_objects, object_sdk, list_reply };
}

function make_list_object_versions_msc_fixture(objects) {
    const list_reply = {
        objects: Array.isArray(objects) ? objects : [objects],
        common_prefixes: [],
        is_truncated: false,
    };
    const list_object_versions = jest.fn().mockResolvedValue(list_reply);
    const metadata_ns = { list_object_versions };
    const object_sdk = {};

    const ns_msc = new NamespaceMultiStorageClass({
        namespace_by_storage_class: {
            [s3_utils.STORAGE_CLASS_STANDARD]: metadata_ns,
            [s3_utils.STORAGE_CLASS_DEEP_ARCHIVE]: {},
        },
    });

    return { ns_msc, metadata_ns, list_object_versions, object_sdk, list_reply };
}

describe('NamespaceMultiStorageClass.restore_object', () => {
    const params = { bucket: BUCKET, key: KEY, days: 7 };

    it('rejects STANDARD objects with error InvalidObjectStorageClass', async () => {
        const { ns_msc, object_sdk, archive_restore_object, update_restore_info } = make_msc_fixture({
            object_restore_info: {
                storage_class: s3_utils.STORAGE_CLASS_STANDARD,
            },
        });

        await expect(ns_msc.restore_object(params, object_sdk)).rejects.toMatchObject({
            code: S3Error.InvalidObjectStorageClass.code,
        });
        expect(update_restore_info).not.toHaveBeenCalled();
        expect(archive_restore_object).not.toHaveBeenCalled();
    });

    it('initiates restore: sets ongoing restore_status then calls archive restore_object', async () => {
        const {
            ns_msc,
            object_sdk,
            archive_restore_object,
            update_restore_info,
        } = make_msc_fixture();

        const result = await ns_msc.restore_object(params, object_sdk);

        expect(result).toEqual({ accepted: true });
        expect(update_restore_info).toHaveBeenCalledTimes(1);
        expect(update_restore_info).toHaveBeenCalledWith({
            obj_id: OBJ_ID,
            restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.START,
            update_restore_status: {
                ongoing: true,
                days: 7,
            },
        });

        expect(archive_restore_object).toHaveBeenCalledTimes(1);
        expect(archive_restore_object).toHaveBeenCalledWith(
            expect.objectContaining({
                bucket: BUCKET,
                key: get_archive_key(BUCKET_ID, OBJ_ID),
                days: 7,
            }),
            object_sdk,
        );
        // Initiate only — BG worker owns clearing ongoing / setting expiry_time.
        expect(update_restore_info.mock.calls[0][0].update_restore_status.expiry_time).toBeUndefined();
        // restore_status update must happen before the archive call.
        expect(update_restore_info.mock.invocationCallOrder[0])
            .toBeLessThan(archive_restore_object.mock.invocationCallOrder[0]);
    });

    it('does not forward client version_id to archive restore_object', async () => {
        const { ns_msc, object_sdk, archive_restore_object } = make_msc_fixture();
        const versioned_params = { ...params, version_id: 'client-version-abc' };

        await ns_msc.restore_object(versioned_params, object_sdk);

        expect(archive_restore_object).toHaveBeenCalledTimes(1);
        const archive_call_params = archive_restore_object.mock.calls[0][0];
        expect(archive_call_params.key).toBe(get_archive_key(BUCKET_ID, OBJ_ID));
        expect(archive_call_params).not.toHaveProperty('version_id');
    });

    it('rejects when restore_status.ongoing is true with error RestoreAlreadyInProgress', async () => {
        const { ns_msc, object_sdk, archive_restore_object, update_restore_info } = make_msc_fixture({
            object_restore_info: {
                restore_status: { ongoing: true, days: 3 },
            },
        });

        await expect(ns_msc.restore_object(params, object_sdk)).rejects.toMatchObject({
            code: S3Error.RestoreAlreadyInProgress.code,
        });
        expect(update_restore_info).not.toHaveBeenCalled();
        expect(archive_restore_object).not.toHaveBeenCalled();
    });

    it('replaces expiry with now+days even when that shortens it', async () => {
        const future_expiry = new Date('2099-01-01T00:00:00Z');
        const { ns_msc, object_sdk, archive_restore_object, update_restore_info } = make_msc_fixture({
            object_restore_info: {
                storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                restore_status: {
                    ongoing: false,
                    expiry_time: future_expiry.getTime(),
                },
            },
        });

        const before = Date.now();
        const result = await ns_msc.restore_object({ ...params, days: 14 }, object_sdk);
        const after = Date.now();

        expect(result.accepted).toBe(false);
        expect(result.storage_class).toBe(s3_utils.STORAGE_CLASS_GLACIER);
        const expected_min = compute_restore_expiry(14, new Date(before)).getTime();
        const expected_max = compute_restore_expiry(14, new Date(after)).getTime();
        expect(result.expires_on.getTime()).toBeGreaterThanOrEqual(expected_min);
        expect(result.expires_on.getTime()).toBeLessThanOrEqual(expected_max);
        expect(result.expires_on.getTime()).toBeLessThan(future_expiry.getTime());

        expect(update_restore_info).toHaveBeenCalledWith({
            obj_id: OBJ_ID,
            restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.UPDATE_EXPIRY,
            update_restore_status: {
                ongoing: false,
                expiry_time: result.expires_on.getTime(),
            },
        });
        expect(archive_restore_object).not.toHaveBeenCalled();
    });

    it('updates expiry to now+days when that is later than existing', async () => {
        const existing_expiry = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
        const { ns_msc, object_sdk, archive_restore_object, update_restore_info } = make_msc_fixture({
            object_restore_info: {
                restore_status: {
                    ongoing: false,
                    expiry_time: existing_expiry.getTime(),
                },
            },
        });

        const before = Date.now();
        const result = await ns_msc.restore_object({ ...params, days: 14 }, object_sdk);
        const after = Date.now();

        expect(result.accepted).toBe(false);
        const expected_min = compute_restore_expiry(14, new Date(before)).getTime();
        const expected_max = compute_restore_expiry(14, new Date(after)).getTime();
        expect(result.expires_on.getTime()).toBeGreaterThanOrEqual(expected_min);
        expect(result.expires_on.getTime()).toBeLessThanOrEqual(expected_max);
        expect(result.expires_on.getTime()).toBeGreaterThan(existing_expiry.getTime());

        expect(update_restore_info).toHaveBeenCalledWith({
            obj_id: OBJ_ID,
            restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.UPDATE_EXPIRY,
            update_restore_status: {
                ongoing: false,
                expiry_time: result.expires_on.getTime(),
            },
        });
        expect(archive_restore_object).not.toHaveBeenCalled();
    });

    it('re-initiates restore when previous expiry has passed', async () => {
        const { ns_msc, archive_restore_object, object_sdk, update_restore_info } = make_msc_fixture({
            object_restore_info: {
                restore_status: {
                    ongoing: false,
                    expiry_time: new Date('2000-01-01T00:00:00Z').getTime(),
                },
            },
        });

        const result = await ns_msc.restore_object(params, object_sdk);

        expect(result).toEqual({ accepted: true });
        expect(update_restore_info).toHaveBeenCalledWith(
            expect.objectContaining({
                restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.START,
                update_restore_status: expect.objectContaining({ ongoing: true, days: 7 }),
            }),
        );
        expect(archive_restore_object).toHaveBeenCalledTimes(1);
    });

    it('clears ongoing and rethrows when archive restore_object fails', async () => {
        const archive_err = new Error('archive restore failed');
        const { ns_msc, object_sdk, update_restore_info } = make_msc_fixture({
            archive_restore_impl: async () => {
                throw archive_err;
            },
        });

        await expect(ns_msc.restore_object(params, object_sdk)).rejects.toBe(archive_err);
        expect(update_restore_info).toHaveBeenCalledTimes(2);
        expect(update_restore_info).toHaveBeenNthCalledWith(1, expect.objectContaining({
            restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.START,
            update_restore_status: expect.objectContaining({ ongoing: true, days: 7 }),
        }));
        expect(update_restore_info).toHaveBeenNthCalledWith(2, expect.objectContaining({
            restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.CLEAR_CLAIM,
            expected_restore_claim_id: CLAIM_ID,
            update_restore_status: { ongoing: false },
        }));
    });

    it('keeps ongoing when archive throws error RestoreAlreadyInProgress', async () => {
        const { ns_msc, object_sdk, update_restore_info } = make_msc_fixture({
            archive_restore_impl: async () => {
                throw new S3Error(S3Error.RestoreAlreadyInProgress);
            },
        });

        await expect(ns_msc.restore_object(params, object_sdk)).rejects.toMatchObject({
            code: S3Error.RestoreAlreadyInProgress.code,
        });
        expect(update_restore_info).toHaveBeenCalledTimes(1);
        expect(update_restore_info).toHaveBeenCalledWith(expect.objectContaining({
            restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.START,
            update_restore_status: expect.objectContaining({ ongoing: true }),
        }));
    });

    it('rejects when restore claim fails with RESTORE_ALREADY_IN_PROGRESS', async () => {
        const { ns_msc, object_sdk, archive_restore_object, update_restore_info } = make_msc_fixture();
        update_restore_info.mockRejectedValueOnce(new RpcError('RESTORE_ALREADY_IN_PROGRESS', 'restore already in progress'));

        await expect(ns_msc.restore_object(params, object_sdk)).rejects.toMatchObject({
            rpc_code: 'RESTORE_ALREADY_IN_PROGRESS',
        });
        expect(archive_restore_object).not.toHaveBeenCalled();
    });

    it('rejects when START returns cas_matched false', async () => {
        const { ns_msc, object_sdk, archive_restore_object, update_restore_info } = make_msc_fixture();
        update_restore_info.mockResolvedValueOnce({ cas_matched: false });

        await expect(ns_msc.restore_object(params, object_sdk)).rejects.toMatchObject({
            code: S3Error.RestoreAlreadyInProgress.code,
        });
        expect(archive_restore_object).not.toHaveBeenCalled();
    });

    it('rejects when START succeeds without restore_claim_id', async () => {
        const { ns_msc, object_sdk, archive_restore_object, update_restore_info } = make_msc_fixture();
        update_restore_info.mockResolvedValueOnce({ cas_matched: true });

        await expect(ns_msc.restore_object(params, object_sdk)).rejects.toThrow(
            'NamespaceMultiStorageClass.restore_object: missing restore_claim_id on successful START reply');
        expect(archive_restore_object).not.toHaveBeenCalled();
    });

    it('rejects when UPDATE_EXPIRY returns cas_matched false', async () => {
        const future_expiry = new Date('2099-01-01T00:00:00Z');
        const { ns_msc, object_sdk, archive_restore_object, update_restore_info } = make_msc_fixture({
            object_restore_info: {
                storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                restore_status: {
                    ongoing: false,
                    expiry_time: future_expiry.getTime(),
                },
            },
        });
        update_restore_info.mockResolvedValueOnce({ cas_matched: false });

        await expect(ns_msc.restore_object(params, object_sdk)).rejects.toMatchObject({
            code: S3Error.RestoreAlreadyInProgress.code,
        });
        expect(archive_restore_object).not.toHaveBeenCalled();
    });

    it('allows client retry after failed archive initiate once ongoing is cleared', async () => {
        const archive_err = new Error('archive restore failed');
        const first = make_msc_fixture({
            archive_restore_impl: async () => {
                throw archive_err;
            },
        });
        await expect(first.ns_msc.restore_object(params, first.object_sdk)).rejects.toBe(archive_err);
        expect(first.update_restore_info).toHaveBeenNthCalledWith(2, expect.objectContaining({
            restore_update_intent: CONSTANTS.ARCHIVE.RESTORE_UPDATE_INTENT.CLEAR_CLAIM,
            expected_restore_claim_id: CLAIM_ID,
            update_restore_status: { ongoing: false },
        }));

        // After compensating clear: ongoing=false → new initiate is allowed.
        const second = make_msc_fixture({
            object_restore_info: {
                restore_status: { ongoing: false },
            },
        });
        const result = await second.ns_msc.restore_object(params, second.object_sdk);
        expect(result).toEqual({ accepted: true });
        expect(second.archive_restore_object).toHaveBeenCalledTimes(1);
    });

    it('propagates NO_SUCH_OBJECT when object is deleted or missing', async () => {
        // get_object_restore_info → find_object_md → check_object_mode throws for
        // missing, soft-deleted, or delete-marker objects.
        const {
            ns_msc,
            object_sdk,
            get_object_restore_info,
            update_restore_info,
            archive_restore_object,
        } = make_msc_fixture();
        const no_such_object_err = new RpcError('NO_SUCH_OBJECT',
            `No such object: bucket ${BUCKET} key ${KEY}`);
        get_object_restore_info.mockRejectedValue(no_such_object_err);

        await expect(ns_msc.restore_object(params, object_sdk)).rejects.toBe(no_such_object_err);
        expect(update_restore_info).not.toHaveBeenCalled();
        expect(archive_restore_object).not.toHaveBeenCalled();
    });

    it('rethrows archive error when clear restore claim returns false', async () => {
        const archive_err = new Error('archive restore failed');
        const { ns_msc, object_sdk, update_restore_info } = make_msc_fixture({
            archive_restore_impl: async () => {
                throw archive_err;
            },
        });
        update_restore_info
            .mockResolvedValueOnce({ cas_matched: true, restore_claim_id: CLAIM_ID })
            .mockResolvedValueOnce({ cas_matched: false });

        await expect(ns_msc.restore_object(params, object_sdk)).rejects.toBe(archive_err);
        expect(update_restore_info).toHaveBeenCalledTimes(2);
    });
});

describe('NamespaceMultiStorageClass.read_object_md', () => {
    const params = { bucket: BUCKET, key: KEY };

    it('omits restore_status when restore expiry_time is in the past', async () => {
        const { ns_msc, object_sdk } = make_read_object_md_msc_fixture({
            key: KEY,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            restore_status: {
                ongoing: false,
                expiry_time: new Date('2000-01-01T00:00:00Z').getTime(),
            },
        });
        const object_md = await ns_msc.read_object_md(params, object_sdk);
        expect(object_md).not.toHaveProperty('restore_status');
        expect(object_md.storage_class).toBe(s3_utils.STORAGE_CLASS_DEEP_ARCHIVE);
    });

    it('returns restore_status when restore is ongoing', async () => {
        const restore_status = { ongoing: true, days: 7 };
        const { ns_msc, object_sdk } = make_read_object_md_msc_fixture({
            key: KEY,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            restore_status,
        });
        const object_md = await ns_msc.read_object_md(params, object_sdk);
        expect(object_md.restore_status).toEqual(restore_status);
    });

    it('returns restore_status when temporary restore is still active', async () => {
        const restore_status = {
            ongoing: false,
            expiry_time: new Date('2099-01-01T00:00:00Z').getTime(),
        };
        const { ns_msc, object_sdk } = make_read_object_md_msc_fixture({
            key: KEY,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            restore_status,
        });
        const object_md = await ns_msc.read_object_md(params, object_sdk);
        expect(object_md.restore_status).toEqual(restore_status);
    });

    it('omits restore_status when restore failed without expiry_time', async () => {
        const { ns_msc, object_sdk } = make_read_object_md_msc_fixture({
            key: KEY,
            storage_class: s3_utils.STORAGE_CLASS_GLACIER,
            restore_status: { ongoing: false },
        });
        const object_md = await ns_msc.read_object_md(params, object_sdk);
        expect(object_md).not.toHaveProperty('restore_status');
    });

    it('omits restore_status when restore expiry_time is invalid', async () => {
        const { ns_msc, object_sdk } = make_read_object_md_msc_fixture({
            key: KEY,
            storage_class: s3_utils.STORAGE_CLASS_GLACIER,
            restore_status: {
                ongoing: false,
                expiry_time: 'invalid',
            },
        });
        const object_md = await ns_msc.read_object_md(params, object_sdk);
        expect(object_md.restore_status).toBeUndefined();
    });
});

describe('NamespaceMultiStorageClass.list_objects', () => {
    const params = { bucket: BUCKET, prefix: '', limit: 1000 };

    it('omits restore_status when restore expiry_time is in the past', async () => {
        const { ns_msc, object_sdk } = make_list_objects_msc_fixture({
            key: KEY,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            restore_status: {
                ongoing: false,
                expiry_time: new Date('2000-01-01T00:00:00Z').getTime(),
            },
        });
        const reply = await ns_msc.list_objects(params, object_sdk);
        expect(reply.objects[0]).not.toHaveProperty('restore_status');
        expect(reply.objects[0].storage_class).toBe(s3_utils.STORAGE_CLASS_DEEP_ARCHIVE);
        expect(reply.is_truncated).toBe(false);
        expect(reply.common_prefixes).toEqual([]);
    });

    it('returns restore_status when restore is ongoing', async () => {
        const restore_status = { ongoing: true, days: 7 };
        const { ns_msc, object_sdk } = make_list_objects_msc_fixture({
            key: KEY,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            restore_status,
        });
        const reply = await ns_msc.list_objects(params, object_sdk);
        expect(reply.objects[0].restore_status).toEqual(restore_status);
    });

    it('returns restore_status when temporary restore is still active', async () => {
        const restore_status = {
            ongoing: false,
            expiry_time: new Date('2099-01-01T00:00:00Z').getTime(),
        };
        const { ns_msc, object_sdk } = make_list_objects_msc_fixture({
            key: KEY,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            restore_status,
        });
        const reply = await ns_msc.list_objects(params, object_sdk);
        expect(reply.objects[0].restore_status).toEqual(restore_status);
    });

    it('omits restore_status when restore failed without expiry_time', async () => {
        const { ns_msc, object_sdk } = make_list_objects_msc_fixture({
            key: KEY,
            storage_class: s3_utils.STORAGE_CLASS_GLACIER,
            restore_status: { ongoing: false },
        });
        const reply = await ns_msc.list_objects(params, object_sdk);
        expect(reply.objects[0]).not.toHaveProperty('restore_status');
    });

    it('omits restore_status when restore expiry_time is invalid', async () => {
        const { ns_msc, object_sdk } = make_list_objects_msc_fixture({
            key: KEY,
            storage_class: s3_utils.STORAGE_CLASS_GLACIER,
            restore_status: {
                ongoing: false,
                expiry_time: 'invalid',
            },
        });
        const reply = await ns_msc.list_objects(params, object_sdk);
        expect(reply.objects[0].restore_status).toBeUndefined();
    });

    it('omits restore_status independently for each object on the same page', async () => {
        const active_restore_status = {
            ongoing: false,
            expiry_time: new Date('2099-01-01T00:00:00Z').getTime(),
        };
        const ongoing_restore_status = { ongoing: true, days: 7 };
        const { ns_msc, object_sdk } = make_list_objects_msc_fixture([
            {
                key: 'archived/active',
                storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
                restore_status: active_restore_status,
            },
            {
                key: 'archived/expired',
                storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
                restore_status: {
                    ongoing: false,
                    expiry_time: new Date('2000-01-01T00:00:00Z').getTime(),
                },
            },
            {
                key: 'archived/ongoing',
                storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                restore_status: ongoing_restore_status,
            },
        ]);
        const reply = await ns_msc.list_objects(params, object_sdk);
        expect(reply.objects).toHaveLength(3);

        const active_object = reply.objects.find(obj => obj.key === 'archived/active');
        const expired_object = reply.objects.find(obj => obj.key === 'archived/expired');
        const ongoing_object = reply.objects.find(obj => obj.key === 'archived/ongoing');
        expect(active_object).toBeDefined();
        expect(expired_object).toBeDefined();
        expect(ongoing_object).toBeDefined();
        expect(active_object.restore_status).toEqual(active_restore_status);
        expect(expired_object).not.toHaveProperty('restore_status');
        expect(ongoing_object.restore_status).toEqual(ongoing_restore_status);
    });
});

describe('NamespaceMultiStorageClass.list_object_versions', () => {
    const params = { bucket: BUCKET, prefix: '', limit: 1000 };

    it('omits restore_status when restore expiry_time is in the past', async () => {
        const { ns_msc, object_sdk } = make_list_object_versions_msc_fixture({
            key: KEY,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            restore_status: {
                ongoing: false,
                expiry_time: new Date('2000-01-01T00:00:00Z').getTime(),
            },
        });
        const reply = await ns_msc.list_object_versions(params, object_sdk);
        expect(reply.objects[0]).not.toHaveProperty('restore_status');
        expect(reply.objects[0].storage_class).toBe(s3_utils.STORAGE_CLASS_DEEP_ARCHIVE);
        expect(reply.is_truncated).toBe(false);
        expect(reply.common_prefixes).toEqual([]);
    });

    it('returns restore_status when restore is ongoing', async () => {
        const restore_status = { ongoing: true, days: 7 };
        const { ns_msc, object_sdk } = make_list_object_versions_msc_fixture({
            key: KEY,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            restore_status,
        });
        const reply = await ns_msc.list_object_versions(params, object_sdk);
        expect(reply.objects[0].restore_status).toEqual(restore_status);
    });

    it('returns restore_status when temporary restore is still active', async () => {
        const restore_status = {
            ongoing: false,
            expiry_time: new Date('2099-01-01T00:00:00Z').getTime(),
        };
        const { ns_msc, object_sdk } = make_list_object_versions_msc_fixture({
            key: KEY,
            storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
            restore_status,
        });
        const reply = await ns_msc.list_object_versions(params, object_sdk);
        expect(reply.objects[0].restore_status).toEqual(restore_status);
    });

    it('omits restore_status when restore failed without expiry_time', async () => {
        const { ns_msc, object_sdk } = make_list_object_versions_msc_fixture({
            key: KEY,
            storage_class: s3_utils.STORAGE_CLASS_GLACIER,
            restore_status: { ongoing: false },
        });
        const reply = await ns_msc.list_object_versions(params, object_sdk);
        expect(reply.objects[0]).not.toHaveProperty('restore_status');
    });

    it('omits restore_status when restore expiry_time is invalid', async () => {
        const { ns_msc, object_sdk } = make_list_object_versions_msc_fixture({
            key: KEY,
            storage_class: s3_utils.STORAGE_CLASS_GLACIER,
            restore_status: {
                ongoing: false,
                expiry_time: 'invalid',
            },
        });
        const reply = await ns_msc.list_object_versions(params, object_sdk);
        expect(reply.objects[0].restore_status).toBeUndefined();
    });

    it('omits restore_status independently for each object on the same page', async () => {
        const active_restore_status = {
            ongoing: false,
            expiry_time: new Date('2099-01-01T00:00:00Z').getTime(),
        };
        const ongoing_restore_status = { ongoing: true, days: 7 };
        const { ns_msc, object_sdk } = make_list_object_versions_msc_fixture([
            {
                key: 'archived/active',
                storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
                restore_status: active_restore_status,
            },
            {
                key: 'archived/expired',
                storage_class: s3_utils.STORAGE_CLASS_DEEP_ARCHIVE,
                restore_status: {
                    ongoing: false,
                    expiry_time: new Date('2000-01-01T00:00:00Z').getTime(),
                },
            },
            {
                key: 'archived/ongoing',
                storage_class: s3_utils.STORAGE_CLASS_GLACIER,
                restore_status: ongoing_restore_status,
            },
        ]);
        const reply = await ns_msc.list_object_versions(params, object_sdk);
        expect(reply.objects).toHaveLength(3);

        const active_object = reply.objects.find(obj => obj.key === 'archived/active');
        const expired_object = reply.objects.find(obj => obj.key === 'archived/expired');
        const ongoing_object = reply.objects.find(obj => obj.key === 'archived/ongoing');
        expect(active_object).toBeDefined();
        expect(expired_object).toBeDefined();
        expect(ongoing_object).toBeDefined();
        expect(active_object.restore_status).toEqual(active_restore_status);
        expect(expired_object).not.toHaveProperty('restore_status');
        expect(ongoing_object.restore_status).toEqual(ongoing_restore_status);
    });
});
