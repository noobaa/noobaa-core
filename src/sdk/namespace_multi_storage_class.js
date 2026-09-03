/* Copyright (C) 2024 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../util/debug_module')(__filename);
const s3_utils = require('../endpoint/s3/s3_utils');
const S3Error = require('../endpoint/s3/s3_errors').S3Error;
const { get_archive_key, throw_if_restore_incomplete, is_restore_active, compute_restore_expiry } = require('../util/deep_archive_utils');
const { get_create_object_upload_params, get_complete_object_upload_params, CREATE_MULTIPART_PARAMS,
    COMPLETE_MULTIPART_PARAMS, destroy_source_stream } = require('../util/object_utils');

/**
 * NamespaceMultiStorageClass routes operations to different namespaces based on
 * the object's storage class — analogous to NamespaceMerge, but keyed by
 * storage_class instead of read/write resources.
 *
 * Metadata (MD) is always stored in the default (STANDARD) namespace and is
 * the single source of truth for all storage classes. Non-default namespaces
 * (e.g. NamespaceS3 for DEEP_ARCHIVE) store only object data.
 *
 * @implements {nb.Namespace}
 */
class NamespaceMultiStorageClass {

    /**
     * @param {{
     *   namespace_by_storage_class: { [storage_class: string]: nb.Namespace },
     *   default_storage_class?: string,
     * }} args
     */
    constructor({ namespace_by_storage_class, default_storage_class }) {
        if (!namespace_by_storage_class || !Object.keys(namespace_by_storage_class).length) {
            throw new Error('NamespaceMultiStorageClass requires a non-empty namespaces map');
        }
        this.namespace_by_storage_class = namespace_by_storage_class;
        this.default_storage_class = default_storage_class || s3_utils.STORAGE_CLASS_STANDARD;
        this._metadata_ns = this.namespace_by_storage_class[this.default_storage_class];
        if (!this._metadata_ns) {
            throw new Error(`NamespaceMultiStorageClass: missing namespace for default storage class '${this.default_storage_class}'`);
        }
    }

    /**
     * Returns this router as the write target.
     * Used by ObjectSDK copy to resolve the actual write backend for server-side copy checks.
     * @returns {nb.Namespace}
     */
    get_write_resource() {
        return this;
    }

    /**
     * Server-side copy is disabled (same restriction as NamespaceMerge).
     * CopyObject is still covered via ObjectSDK's stream fallback: because this returns
     * false, fix_copy_source_params reads the source object via read_object_stream and passes it as source_stream to 
     * the target namespace's upload_object. The target namespace is resolved by storage_class
     * {@link upload_object}. Archive sources that are not restored throw InvalidObjectState.
     * @param {nb.Namespace} other
     * @param {nb.ObjectInfo} other_md
     * @param {object} params
     * @returns {boolean}
     */
    is_server_side_copy(other, other_md, params) {
        return false;
    }

    /**
     * @param {string} bucket
     * @returns {string}
     */
    get_bucket(bucket) {
        return bucket;
    }

    /**
     * Always writable. Deep-archive data is NooBaa-managed (like a pool/backingstore),
     * so namespace-resource access_mode does not apply.
     * @returns {boolean}
     */
    is_readonly_namespace() {
        return false;
    }

    /////////////////
    // OBJECT LIST //
    /////////////////

    /**
     * Lists objects from the metadata namespace only.
     * Metadata for all storage classes is stored there.
     * Omits restore_status on each object when restore is expired or incomplete.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async list_objects(params, object_sdk) {
        const reply = await this._metadata_ns.list_objects(params, object_sdk);
        return {
            ...reply,
            objects: reply.objects.map(obj => this._omit_inactive_restore_status(obj)),
        };
    }

    /**
     * Lists in-progress multipart uploads from the metadata namespace.
     * Client UploadId is the NB obj_id; target_data_info.upload_id is stored on the upload
     * object and looked up when talking to the archive backend.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async list_uploads(params, object_sdk) {
        return this._metadata_ns.list_uploads(params, object_sdk);
    }

    /**
     * Lists object versions from the metadata namespace only.
     * Omits restore_status on each object when restore is expired or incomplete.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async list_object_versions(params, object_sdk) {
        const reply = await this._metadata_ns.list_object_versions(params, object_sdk);
        return {
            ...reply,
            objects: reply.objects.map(obj => this._omit_inactive_restore_status(obj)),
        };
    }

    /////////////////
    // OBJECT READ //
    /////////////////

    /**
     * Reads object metadata from the metadata namespace.
     * Omits restore_status when restore is expired or incomplete
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<nb.ObjectInfo>}
     */
    async read_object_md(params, object_sdk) {
        const object_md = await this._metadata_ns.read_object_md(params, object_sdk);
        return this._omit_inactive_restore_status(object_md);
    }

    /**
     * Streams object data.
     * STANDARD objects and actively restored archive objects are read from the
     * metadata namespace (NamespaceNB holds the live/restore copy).
     * Non-default storage classes (e.g. DEEP_ARCHIVE / GLACIER) that are not
     * restored throw InvalidObjectState.
     * add res to the params when NamespaceFS becomes a supported deep-archive resource
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<import('stream').Readable>}
     */
    async read_object_stream(params, object_sdk) {
        const object_md = params.object_md || await this._metadata_ns.read_object_md(params, object_sdk);
        const storage_class = s3_utils.parse_storage_class(object_md.storage_class);
        if (!this.is_standard_storage_class(storage_class)) {
            throw_if_restore_incomplete(params.bucket, object_md);
        }
        return this._metadata_ns.read_object_stream({ ...params, object_md }, object_sdk);
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    /**
     * Uploads an object. Mirrors object_io.upload_object (create → data → complete),
     * but writes data plain to the storage-class target and MD via NamespaceNB helpers.
     * STANDARD (default namespace): full NB upload (data + MD).
     * Non-default storage classes: Currently only DEEP_ARCHIVE and GLACIER are supported
     * MD-only create/complete in NB; data written to the target namespace under get_archive_key(bucket_id, obj_id).
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async upload_object(params, object_sdk) {
        const storage_class = params.storage_class;
        const target_ns = this.get_namespace_for_storage_class(storage_class);
        if (this.is_standard_storage_class(storage_class)) {
            return target_ns.upload_object(params, object_sdk);
        }
        return this._upload_object_non_standard_sc(params, object_sdk, { storage_class, target_ns });
    }

    /**
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    upload_blob_block(params, object_sdk) {
        throw new S3Error(S3Error.NotImplemented);
    }

    /**
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    commit_blob_block_list(params, object_sdk) {
        throw new S3Error(S3Error.NotImplemented);
    }

    /**
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    get_blob_block_lists(params, object_sdk) {
        throw new S3Error(S3Error.NotImplemented);
    }

    /////////////////////////////
    // OBJECT MULTIPART UPLOAD //
    /////////////////////////////

    /**
     * Creates a multipart upload.
     * STANDARD: delegated to the target namespace (NamespaceNB) (data + MD in NooBaa).
     * GLACIER / DEEP_ARCHIVE: create upload MD in NooBaa, create MPU on the
     * archive resource, and map NooBaa `obj_id` (client UploadId) to
     * `target_data_info.upload_id` on the upload MD.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async create_object_upload(params, object_sdk) {
        const storage_class = params.storage_class;
        const target_ns = this.get_namespace_for_storage_class(storage_class);
        if (this.is_standard_storage_class(storage_class)) {
            return target_ns.create_object_upload(params, object_sdk);
        }
        return this._create_object_upload_archive(params, object_sdk, { storage_class, target_ns });
    }

    /**
     * Uploads a multipart part.
     * STANDARD: delegated to the target namespace directly (NamespaceNB) (MD + data in NooBaa)
     * Archive: create part MD → upload part data to archive → complete part MD
     * On failure - Destroy the source stream
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async upload_multipart(params, object_sdk) {
        // Resolve upload MD before touching the body. Do not destroy the source
        // stream on preflight NoSuchUpload — that aborts the HTTP request mid-body
        // and surfaces as socket hang up to the client.
        const upload_md = await this._read_upload_md(params, object_sdk);
        const storage_class = upload_md.storage_class;
        const target_ns = this.get_namespace_for_storage_class(storage_class);
        if (this.is_standard_storage_class(storage_class)) {
            return target_ns.upload_multipart(params, object_sdk);
        }
        try {
            return await this._upload_multipart_archive(params, object_sdk, { upload_md, storage_class, target_ns });
        } catch (err) {
            destroy_source_stream(params);
            throw err;
        }
    }

    /**
     * Lists uploaded parts from the metadata namespace (source of truth for part MD
     * for all storage classes, including GLACIER / DEEP_ARCHIVE).
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async list_multiparts(params, object_sdk) {
        return this._metadata_ns.list_multiparts(params, object_sdk);
    }

    /**
     * Completes a multipart upload.
     * STANDARD: delegated to the target namespace directly (NamespaceNB).
     * Archive: completes on the archive resource, then completes MD in NooBaa
     * via the multipart path (validates part list, clears uncommitted, soft-deletes
     * unused multiparts) with etag/size from archive.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async complete_object_upload(params, object_sdk) {
        const upload_md = await this._read_upload_md(params, object_sdk);
        const storage_class = upload_md.storage_class;
        const target_ns = this.get_namespace_for_storage_class(storage_class);
        if (this.is_standard_storage_class(storage_class)) {
            return target_ns.complete_object_upload(params, object_sdk);
        }
        return this._complete_object_upload_archive(params, object_sdk, { upload_md, storage_class, target_ns });
    }

    /**
     * Aborts a multipart upload.
     * STANDARD: delegated to the target namespace (NamespaceNB).
     * Archive: aborts on the archive resource and soft-deletes upload MD in NooBaa.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object|void>}
     */
    async abort_object_upload(params, object_sdk) {
        const upload_md = await this._read_upload_md(params, object_sdk);
        const storage_class = upload_md.storage_class;
        const target_ns = this.get_namespace_for_storage_class(storage_class);
        if (this.is_standard_storage_class(storage_class)) {
            return target_ns.abort_object_upload(params, object_sdk);
        }
        return this._abort_object_upload_archive(params, object_sdk, { upload_md, storage_class, target_ns });
    }

    ///////////////////
    // OBJECT DELETE //
    ///////////////////

    /**
     * Deletes the object MD from the default namespace. Archive data cleanup
     * (DEEP_ARCHIVE / GLACIER objects) is handled asynchronously by ObjectsReclaimer.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async delete_object(params, object_sdk) {
        return this._metadata_ns.delete_object(params, object_sdk);
    }

    /**
     * Deletes object metadata from the default namespace. Archive data cleanup
     * (DEEP_ARCHIVE / GLACIER objects) is handled asynchronously by ObjectsReclaimer.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object[]>}
     */
    async delete_multiple_objects(params, object_sdk) {
        return this._metadata_ns.delete_multiple_objects(params, object_sdk);
    }

    ////////////////////
    // OBJECT TAGGING //
    ////////////////////

    // Tags are stored in NB metadata — route directly to the default namespace.

    /**
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async get_object_tagging(params, object_sdk) {
        return this._metadata_ns.get_object_tagging(params, object_sdk);
    }

    /**
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async delete_object_tagging(params, object_sdk) {
        return this._metadata_ns.delete_object_tagging(params, object_sdk);
    }

    /**
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async put_object_tagging(params, object_sdk) {
        return this._metadata_ns.put_object_tagging(params, object_sdk);
    }

    //////////
    // ACLs //
    //////////

    // ACLs are stored in NB metadata — route directly to the default namespace.

    /**
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async get_object_acl(params, object_sdk) {
        return this._metadata_ns.get_object_acl(params, object_sdk);
    }

    /**
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async put_object_acl(params, object_sdk) {
        return this._metadata_ns.put_object_acl(params, object_sdk);
    }

    ///////////////////
    //  OBJECT LOCK  //
    ///////////////////

    // Object lock settings (legal hold, retention) are stored exclusively in NB
    // metadata — they have no representation in the archive backend. All four
    // operations therefore go directly to the default namespace without reading
    // the object's storage class first.

    /**
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async get_object_legal_hold(params, object_sdk) {
        return this._metadata_ns.get_object_legal_hold(params, object_sdk);
    }

    /**
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async put_object_legal_hold(params, object_sdk) {
        return this._metadata_ns.put_object_legal_hold(params, object_sdk);
    }

    /**
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async get_object_retention(params, object_sdk) {
        return this._metadata_ns.get_object_retention(params, object_sdk);
    }

    /**
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async put_object_retention(params, object_sdk) {
        return this._metadata_ns.put_object_retention(params, object_sdk);
    }

    ///////////////////
    //      ULS      //
    ///////////////////

    /**
     * @returns {Promise<never>}
     */
    async create_uls() {
        throw new S3Error(S3Error.NotImplemented);
    }

    /**
     * @returns {Promise<never>}
     */
    async delete_uls() {
        throw new S3Error(S3Error.NotImplemented);
    }

    ////////////////////
    // OBJECT RESTORE //
    ////////////////////

    /**
     * Initiates or updates a temporary restore of an archived object.
     * Loads restore fields via get_object_restore_info (no s3:GetObject check),
     * records restore_status on object MD, and calls restore_object on the archive
     * target namespace. A background worker later completes the temporary STANDARD
     * copy and sets expiry_time. On an already-restored object, replaces expiry with
     * now+days (AWS-compatible, may shorten). On archive failure other than
     * RestoreAlreadyInProgress, clears ongoing so the client can retry.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<{ accepted: boolean, expires_on?: Date, storage_class?: string }>}
     */
    async restore_object(params, object_sdk) {
        const { bucket, key, days } = params;
        // Use restore-specific MD RPC (no s3:GetObject). Endpoint already checked s3:RestoreObject.
        const object_restore_info = await object_sdk.rpc_client.object.get_object_restore_info(
            _.pick(params, 'bucket', 'key', 'version_id')
        );
        const storage_class = s3_utils.parse_storage_class(object_restore_info.storage_class);
        if (!s3_utils.GLACIER_STORAGE_CLASSES.includes(storage_class)) {
            throw new S3Error(S3Error.InvalidObjectStorageClass);
        }
        const target_ns = this.namespace_by_storage_class[storage_class];
        if (!target_ns) {
            throw new S3Error(S3Error.NotImplemented);
        }

        if (object_restore_info.restore_status?.ongoing) {
            throw new S3Error(S3Error.RestoreAlreadyInProgress);
        }

        if (is_restore_active(object_restore_info.restore_status)) {
            const expires_on = compute_restore_expiry(days, new Date());
            await object_sdk.rpc_client.object.update_object_md({ bucket, key, obj_id: object_restore_info.obj_id,
                restore_status: { ongoing: false, expiry_time: expires_on.getTime() } });
            dbg.log1('NamespaceMultiStorageClass.restore_object: updated restore expiry', { bucket, key, expires_on });
            return {
                accepted: false, // accepted:false means already restored
                expires_on,
                storage_class,
            };
        }

        const archive_key = get_archive_key(object_restore_info.bucket_id, object_restore_info.obj_id);
        const archive_params = { ..._.pick(params, 'bucket', 'days', 'encryption'), key: archive_key}; // omit version-id because archive object is keyed by bucket_id/obj_id
        await object_sdk.rpc_client.object.update_object_md({ bucket, key, obj_id: object_restore_info.obj_id,
            restore_status: { ongoing: true, days, ongoing_since: Date.now() } });
        dbg.log1('NamespaceMultiStorageClass.restore_object: initiating archive restore', { bucket, key, archive_key, days });
        try {
            await target_ns.restore_object(archive_params, object_sdk);
        } catch (err) {
            dbg.error('NamespaceMultiStorageClass.restore_object: archive restore failed', { bucket, key, archive_key }, err);
            if (err.code === S3Error.RestoreAlreadyInProgress.code || err.rpc_code === 'RESTORE_ALREADY_IN_PROGRESS') {
                throw err;
            }
            try {
                await object_sdk.rpc_client.object.update_object_md({ bucket, key, obj_id: object_restore_info.obj_id,
                    restore_status: { ongoing: false }});
            } catch (err2) {
                dbg.error('NamespaceMultiStorageClass.restore_object: failed to clear ' +
                    'restore_status after archive failure', { bucket, key, archive_key }, err2);
            }
            throw err;
        }
        return { accepted: true }; // accepted:true means initiate restore succeeded
    }

    //////////////
    // INTERNAL //
    //////////////

    /**
     * Reads in-progress upload routing metadata by obj_id (storage_class,
     * target_data_info). find_object_upload already requires upload_started.
     * Maps missing/non-upload objects to NoSuchUpload (S3 multipart semantics).
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<{ storage_class?: nb.StorageClass, target_data_info?: nb.TargetDataInfo }>}
     */
    async _read_upload_md(params, object_sdk) {
        try {
            const { bucket, key, obj_id } = params;
            s3_utils.throw_if_invalid_upload_id(obj_id);
            return await object_sdk.rpc_client.object.read_object_upload({ bucket, key, obj_id });
        } catch (err) {
            const err_code = err.name || err.Code || err.code;
            if (this._is_no_such_upload_err(err) || err.rpc_code === 'NO_SUCH_OBJECT' || err_code === S3Error.NoSuchKey.code) {
                throw new S3Error(S3Error.NoSuchUpload);
            }
            throw err;
        }
    }

    /**
     * Archive create-multipart flow (aligned with PutObject):
     * 1. Create upload MD in NooBaa (gets obj_id / bucket_id)
     * 2. Create MPU on archive under get_archive_key(bucket_id, obj_id)
     * 3. Update NB MD with target_data_info.upload_id
     * On failure after MD create, aborts the NB upload; if archive MPU was created,
     * also aborts it.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @param {{ storage_class: string, target_ns: nb.Namespace }} options
     * @returns {Promise<object>}
     */
    async _create_object_upload_archive(params, object_sdk, { storage_class, target_ns }) {
        let obj_id;
        let archive_key;
        let target_upload_id;
        const { bucket, key } = params;

        try {
            const create_params = get_create_object_upload_params({ ...params, storage_class });
            dbg.log1('NamespaceMultiStorageClass._create_object_upload_archive: create MD upload', create_params);
            const create_reply = await this._metadata_ns.create_object_upload(create_params, object_sdk);

            obj_id = create_reply.obj_id;
            archive_key = get_archive_key(create_reply.bucket_id, obj_id);
            const create_archive_params = { ...params, key: archive_key, storage_class };

            dbg.log1('NamespaceMultiStorageClass._create_object_upload_archive: create archive MPU', { bucket, key, obj_id, archive_key, storage_class });
            const archive_reply = await target_ns.create_object_upload(create_archive_params, object_sdk);
            target_upload_id = archive_reply.obj_id;

            // target_data_info is set shortly after create_object_upload seeds object_md_cache.
            // Fast MPU (create→parts→complete within the 1s cache TTL) would otherwise complete
            // with a stale object missing target_data_info.upload_id and hit BAD_SIZE (IncompleteBody).

            const update_md_params = { bucket, key, obj_id, target_data_info: { upload_id: target_upload_id }, invalidate_md_cache: true };
            await object_sdk.rpc_client.object.update_object_md(update_md_params);
            dbg.log1('NamespaceMultiStorageClass._create_object_upload_archive: set target_data_info.upload_id', { obj_id, target_upload_id, archive_key });
            return create_reply;
        } catch (err) {
            dbg.warn('NamespaceMultiStorageClass._create_object_upload_archive: failed', { bucket, key, obj_id, archive_key, target_upload_id }, err);
            if (target_upload_id && archive_key) {
                try {
                    const abort_archive_params = { bucket, key: archive_key, obj_id: target_upload_id };
                    await target_ns.abort_object_upload(abort_archive_params, object_sdk);
                } catch (abort_err) {
                    dbg.warn('NamespaceMultiStorageClass._create_object_upload_archive: Failed to abort archive MPU',
                        { bucket, key, archive_key, target_upload_id }, abort_err);
                }
            }
            if (obj_id) {
                try {
                    const abort_md_params = { bucket, key, obj_id };
                    await this._metadata_ns.abort_object_upload(abort_md_params, object_sdk);
                } catch (abort_err) {
                    dbg.warn('NamespaceMultiStorageClass._create_object_upload_archive: Failed to abort MD upload', { obj_id }, abort_err);
                }
            }
            throw err;
        }
    }

    /**
     * MD-first part upload (same order as STANDARD object_io.upload_multipart):
     * create_multipart → upload part data to archive → complete_multipart with archive etag
     * Failed parts leave uncommitted MD for cleanup by Complete/Abort MPU.
     * 1. Create part MD in NooBaa (uncommitted) before writing archive data.
     * 2. Upload part data to archive namespace.
     * 3. Commit part MD with archive etag (no chunk mappings).
     * 4. if failed, uncommitted part is overwritten and MD is soft-deleted by Complete/Abort.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @param {{ upload_md: { target_data_info?: nb.TargetDataInfo }, storage_class: string, target_ns: nb.Namespace }} options
     * @returns {Promise<{ etag: string }>}
     */
    async _upload_multipart_archive(params, object_sdk, { upload_md, storage_class, target_ns }) {
        const { bucket, key, obj_id, num } = params;
        const target_upload_id = upload_md.target_data_info?.upload_id;
        if (!target_upload_id) {
            dbg.error('NamespaceMultiStorageClass._upload_multipart_archive: missing target_data_info.upload_id', { bucket, key, obj_id });
            throw new S3Error(S3Error.NoSuchUpload);
        }
        const bucket_info = await object_sdk.read_bucket_sdk_config_info(bucket);
        const archive_key = get_archive_key(bucket_info._id, obj_id);
        dbg.log1('NamespaceMultiStorageClass._upload_multipart_archive: upload part', { bucket, key, archive_key, num, storage_class });
        try {
            const create_mp_params = _.pick(params, CREATE_MULTIPART_PARAMS);
            const create_mp_reply = await object_sdk.rpc_client.object.create_multipart(create_mp_params);

            const upload_archive_params = { ...params, key: archive_key, obj_id: target_upload_id };
            const archive_reply = await target_ns.upload_multipart(upload_archive_params, object_sdk);

            const etag = s3_utils.parse_etag(archive_reply.etag);
            const complete_params = _.pick({ ...params, multipart_id: create_mp_reply.multipart_id }, COMPLETE_MULTIPART_PARAMS);
            // Persist opaque archive ETag for ListParts (Part Etag is not necessarily the MD5)
            Object.assign(complete_params,
                { size: params.size, num_parts: 0, etag, md5_b64: params.md5_b64, sha256_b64: params.sha256_b64 });
            await object_sdk.rpc_client.object.complete_multipart(complete_params);

            dbg.log1('NamespaceMultiStorageClass._upload_multipart_archive: recorded part MD', { obj_id, num, etag });
            return { etag };
        } catch (err) {
            dbg.warn('NamespaceMultiStorageClass._upload_multipart_archive: failed', { bucket, key, archive_key, num }, err);
            throw err;
        }
    }

    /**
     * Completes archive MPU then completes NooBaa MD via the multipart path
     * (part-list validation, clear uncommitted, soft-delete unused multiparts).
     * Size/etag come from reading the archive object after complete — that reflects
     * only the parts the client included in CompleteMultipartUpload.
     * Retry-safe: if archive complete already succeeded (NoSuchUpload) but MD
     * complete did not, MD read recovers etag/size and finishes MD complete.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @param {{ upload_md: { target_data_info?: nb.TargetDataInfo }, storage_class: nb.StorageClass, target_ns: nb.Namespace }} options
     * @returns {Promise<object>}
     */
    async _complete_object_upload_archive(params, object_sdk, { upload_md, storage_class, target_ns }) {
        const { bucket, key, obj_id } = params;
        const target_upload_id = upload_md.target_data_info?.upload_id;
        if (!target_upload_id) {
            dbg.error('NamespaceMultiStorageClass._complete_object_upload_archive: missing target_data_info.upload_id', { bucket, key, obj_id });
            throw new S3Error(S3Error.NoSuchUpload);
        }
        const bucket_info = await object_sdk.read_bucket_sdk_config_info(bucket);
        const archive_key = get_archive_key(bucket_info._id, obj_id);
        const archive_params = { ...params, key: archive_key, obj_id: target_upload_id };

        dbg.log1('NamespaceMultiStorageClass._complete_object_upload_archive: complete archive MPU', { bucket, key, archive_key, storage_class });
        // Archive complete then NB MD complete are not atomic. If archive succeeds and MD
        // fails, a client retry gets NoSuchUpload from archive (MPU already gone). Treat
        // that as success and finish MD using Head of the archived object.
        try {
            await target_ns.complete_object_upload(archive_params, object_sdk);
        } catch (err) {
            if (!this._is_no_such_upload_err(err)) throw err;
            dbg.warn('NamespaceMultiStorageClass._complete_object_upload_archive: archive MPU already completed, reading object', {
                bucket, archive_key, target_upload_id }, err);
        }

        const archive_md = await target_ns.read_object_md({ bucket, key: archive_key }, object_sdk);
        const { etag, size, last_modified_time, create_time } = archive_md;
        const complete_params = get_complete_object_upload_params({
            ...params,
            etag,
            size,
            last_modified_time: last_modified_time || create_time,
        });
        dbg.log1('NamespaceMultiStorageClass._complete_object_upload_archive: complete MD upload', { ...complete_params, archive_key });
        return this._metadata_ns.complete_object_upload(complete_params, object_sdk);
    }

    /**
     * @param {Error & { code?: string, Code?: string, name?: string, rpc_code?: string }} err
     * @returns {boolean}
     */
    _is_no_such_upload_err(err) {
        const err_code = err.name || err.Code || err.code;
        return err.rpc_code === 'NO_SUCH_UPLOAD' || err_code === S3Error.NoSuchUpload.code;
    }

    /**
     * Aborts archive MPU then soft-deletes NooBaa upload MD.
     * Ignore archive NoSuchUpload (already gone); propagate other archive abort
     * errors so target_data_info.upload_id remains available for retry. MD abort errors
     * also propagate so the client learns whether the UploadId was cleared.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @param {{ upload_md: { target_data_info?: nb.TargetDataInfo }, storage_class: nb.StorageClass, target_ns: nb.Namespace }} options
     * @returns {Promise<object|void>}
     */
    async _abort_object_upload_archive(params, object_sdk, { upload_md, storage_class, target_ns }) {
        const { bucket, key, obj_id } = params;
        const bucket_info = await object_sdk.read_bucket_sdk_config_info(bucket);
        const archive_key = get_archive_key(bucket_info._id, obj_id);
        const target_upload_id = upload_md.target_data_info?.upload_id;
        if (target_upload_id) {
            try {
                dbg.log1('NamespaceMultiStorageClass._abort_object_upload_archive: abort archive MPU', { bucket, key, archive_key, target_upload_id, storage_class });
                await target_ns.abort_object_upload({ bucket, key: archive_key, obj_id: target_upload_id }, object_sdk);
            } catch (archive_err) {
                dbg.warn('NamespaceMultiStorageClass._abort_object_upload_archive: Failed to abort archive MPU', { bucket, key, archive_key, target_upload_id }, archive_err);
                if (!this._is_no_such_upload_err(archive_err)) throw archive_err;
            }
        } else {
            dbg.warn('NamespaceMultiStorageClass._abort_object_upload_archive: missing target_data_info.upload_id, aborting MD only', { bucket, key, obj_id });
        }

        return this._metadata_ns.abort_object_upload(params, object_sdk);
    }

    /**
     * Upload path for non-default storage classes: MD in NB, data plain to target_ns.
     * Flow: create_object_upload (NB MD) → upload_object to archive under
     * get_archive_key(bucket_id, obj_id) → complete_object_upload (NB MD).
     * On failure after MD create, aborts the NB upload.
     *
     * Also covers CopyObject into an archive storage class: when
     * is_server_side_copy is false, ObjectSDK replaces copy_source with
     * source_stream via read_object_stream, so this path receives a normal
     * streamed upload (no separate copy handling needed here).
     *
     * Failure cleanup: abort_object_upload only soft-deletes the NB MD
     * (sets `deleted`). It does not remove data already written to target_ns.
     * ObjectsReclaimer deletes archive objects for deleted object_mds,
     * using get_archive_key(bucket_id, obj_id).
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @param {{ storage_class: string, target_ns: nb.Namespace }} options
     * @returns {Promise<object>}
     */
    async _upload_object_non_standard_sc(params, object_sdk, { storage_class, target_ns }) {
        try {
            const create_params = get_create_object_upload_params({ ...params, storage_class });
            dbg.log1('NamespaceMultiStorageClass._upload_object_non_standard_sc: start MD upload', create_params);
            const create_reply = await this._metadata_ns.create_object_upload(create_params, object_sdk);
            params.obj_id = create_reply.obj_id;

            const archive_key = get_archive_key(create_reply.bucket_id, params.obj_id);
            const data_res = await target_ns.upload_object({ ...params, key: archive_key, storage_class }, object_sdk);
            const { etag, last_modified_time } = data_res || {};

            const complete_params = get_complete_object_upload_params({ ...params, etag, last_modified_time });
            dbg.log1('NamespaceMultiStorageClass._upload_object_non_standard_sc: uploaded data to target ns', {...complete_params, archive_key });

            const complete_reply = await this._metadata_ns.complete_object_upload(complete_params, object_sdk);
            dbg.log1('NamespaceMultiStorageClass._upload_object_non_standard_sc: complete MD upload', complete_params);
            return complete_reply;
        } catch (err) {
            const abort_params = _.pick(params, 'bucket', 'key', 'obj_id');
            dbg.warn('NamespaceMultiStorageClass._upload_object_non_standard_sc: failed upload', abort_params, err);
            // Destroy if the body was never attached (e.g. create_object_upload failed).
            // No err arg: avoid emitting 'error' on a stream with no listeners; original err is rethrown.
            destroy_source_stream(params);
            if (abort_params.obj_id) {
                try {
                    await this._metadata_ns.abort_object_upload(abort_params, object_sdk);
                    dbg.log0('NamespaceMultiStorageClass._upload_object_non_standard_sc: aborted MD upload', abort_params);
                } catch (abort_err) {
                    dbg.warn('NamespaceMultiStorageClass._upload_object_non_standard_sc: Failed to abort MD upload', abort_params, abort_err);
                }
            }
            throw err;
        }
    }

    /**
     * Resolves the namespace for a write based on `storage_class`.
     * Fails if the storage class is not supported or not mapped.
     * @param {nb.StorageClass} storage_class
     * @returns {nb.Namespace}
     */
    get_namespace_for_storage_class(storage_class) {
        const sc = s3_utils.parse_storage_class(storage_class);
        if (this.is_standard_storage_class(sc) || s3_utils.GLACIER_STORAGE_CLASSES.includes(sc)) {
            const target_ns = this.namespace_by_storage_class[sc];
            if (!target_ns) {
                throw new S3Error(S3Error.NotImplemented);
            }
            return target_ns;
        }
        throw new S3Error(S3Error.NotImplemented);
    }

    /**
     * Checks if the storage class is standard.
     * Unset/empty is treated as STANDARD (same as s3_utils.parse_storage_class).
     * @param {nb.StorageClass} storage_class
     * @returns {boolean}
     */
    is_standard_storage_class(storage_class) {
        return s3_utils.parse_storage_class(storage_class) === this.default_storage_class;
    }

    /**
     * Returns object metadata without restore_status when the restore is expired or incomplete.
     * Keeps restore_status when restore is ongoing or still active.
     * @param {nb.ObjectInfo} object_md
     * @returns {nb.ObjectInfo}
     */
    _omit_inactive_restore_status(object_md) {
        const { restore_status } = object_md;
        return (!restore_status || restore_status.ongoing || is_restore_active(restore_status)) ?
            object_md : _.omit(object_md, 'restore_status');
    }
}

module.exports = NamespaceMultiStorageClass;
