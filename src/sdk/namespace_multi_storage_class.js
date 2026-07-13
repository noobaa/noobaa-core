/* Copyright (C) 2024 NooBaa */
'use strict';

const s3_utils = require('../endpoint/s3/s3_utils');
const S3Error = require('../endpoint/s3/s3_errors').S3Error;


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
     * Server-side copy across the router is disabled (same restriction as NamespaceMerge).
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
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<import('stream').Readable>}
     */
    async read_object_stream(params, object_sdk) {
        throw new S3Error(S3Error.NotImplemented);
    }

    ///////////////////
    // OBJECT UPLOAD //
    ///////////////////

    /**
     * Uploads object data to the storage-class backend and writes metadata to NB.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async upload_object(params, object_sdk) {
        throw new S3Error(S3Error.NotImplemented);
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
     * Deletes object metadata via the default (STANDARD) namespace only.
     *
     * For deep archive objects, a separate BG worker (similar to objects_reclaimer)
     * will delete the actual archive data asynchronously.
     * @param {object} params
     * @param {nb.ObjectSDK} object_sdk
     * @returns {Promise<object>}
     */
    async delete_object(params, object_sdk) {
        return this._metadata_ns.delete_object(params, object_sdk);
    }

    /**
     * Deletes object metadata via the default (STANDARD) namespace only.
     *
     * For deep archive objects, a separate BG worker (similar to objects_reclaimer)
     * will delete the actual archive data asynchronously.
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
