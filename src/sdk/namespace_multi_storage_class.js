/* Copyright (C) 2024 NooBaa */
'use strict';

const _ = require('lodash');
const dbg = require('../util/debug_module')(__filename);
const s3_utils = require('../endpoint/s3/s3_utils');
const { get_archive_key, throw_if_restore_incomplete } = require('../util/deep_archive_utils');
const S3Error = require('../endpoint/s3/s3_errors').S3Error;
const { get_create_object_upload_params, get_complete_object_upload_params } = require('../util/object_utils');

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
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async list_objects(params, object_sdk) {
        return this._metadata_ns.list_objects(params, object_sdk);
    }

    /**
     * Lists in-progress multipart uploads from the metadata namespace.
     * Client UploadId is the NB obj_id; archive_upload_id is stored on the upload
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
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async list_object_versions(params, object_sdk) {
        return this._metadata_ns.list_object_versions(params, object_sdk);
    }

    /////////////////
    // OBJECT READ //
    /////////////////

    /**
     * Reads object metadata from the metadata namespace
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<nb.ObjectInfo>}
     */
    async read_object_md(params, object_sdk) {
        return this._metadata_ns.read_object_md(params, object_sdk);
    }

    /**
     * Streams object data.
     * STANDARD (default) objects are read from the metadata namespace.
     * Non-default storage classes (e.g. DEEP_ARCHIVE / GLACIER) are not
     * readable until restored — throw InvalidObjectState.
     * add res to the params when NamespaceFS becomes a supported deep-archive resource
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<import('stream').Readable>}
     */
    async read_object_stream(params, object_sdk) {
        const object_md = params.object_md || await this._metadata_ns.read_object_md(params, object_sdk);
        const storage_class = s3_utils.parse_storage_class(object_md.storage_class);
        if (storage_class !== this.default_storage_class) {
            if (!s3_utils.GLACIER_STORAGE_CLASSES.includes(storage_class)) {
                throw new S3Error(S3Error.NotImplemented);
            }
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
        const storage_class = s3_utils.parse_storage_class(params.storage_class);
        const target_ns = this.namespace_by_storage_class[storage_class];
        if (!target_ns) {
            throw new S3Error(S3Error.NotImplemented);
        }

        if (storage_class === this.default_storage_class) {
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
     * For archive storage classes: create on archive + NB (pass archive_upload_id into
     * NB create_object_upload), return the NB obj_id as the client UploadId.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async create_object_upload(params, object_sdk) {
        throw new S3Error(S3Error.NotImplemented);
    }

    /**
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async upload_multipart(params, object_sdk) {
        throw new S3Error(S3Error.NotImplemented);
    }

    /**
     * Lists uploaded parts from the metadata namespace (source of truth for part metadata).
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async list_multiparts(params, object_sdk) {
        return this._metadata_ns.list_multiparts(params, object_sdk);
    }

    /**
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async complete_object_upload(params, object_sdk) {
        throw new S3Error(S3Error.NotImplemented);
    }

    /**
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async abort_object_upload(params, object_sdk) {
        throw new S3Error(S3Error.NotImplemented);
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
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<{ accepted: boolean }>}
     */
    async restore_object(params, object_sdk) {
        throw new S3Error(S3Error.NotImplemented);
    }

    //////////////
    // INTERNAL //
    //////////////

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
            if (params.source_stream && typeof params.source_stream.destroy === 'function') {
                params.source_stream.destroy();
            }
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
     * Falls back to `default_storage_class` when unset or unmapped.
     * @param {string} [storage_class]
     * @returns {nb.Namespace}
     */
    _ns_for_storage_class(storage_class) {
        const sc = s3_utils.parse_storage_class(storage_class);
        return this.namespace_by_storage_class[sc] || this.namespace_by_storage_class[this.default_storage_class];
    }
}

module.exports = NamespaceMultiStorageClass;
