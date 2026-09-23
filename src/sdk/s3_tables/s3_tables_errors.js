/* Copyright (C) 2026 NooBaa */
'use strict';

/**
 * The complete set of semantic errors the S3 Tables logic layer throws
 * (design §6.4 rule 4, §7.3). Protocol-neutral on purpose: §7.3 has each facade
 * render the same error differently - the IRC facade as an IcebergErrorResponse and
 * the S3Tables facade as an AWS exception - and on the two commit operations only
 * CommitStateUnknown renders as 5xx. So there is no http_code here; rendering belongs
 * to the facades.
 *
 * This module requires nothing, which keeps it usable from inside the commit worker
 * thread (§8.1 - the engine is effect-free by constraint).
 */

/**
 * @typedef {{ code: string, message: string }} S3TablesErrorSpec
 */

class S3TablesError extends Error {

    /**
     * @param {S3TablesErrorSpec} error_spec
     * @param {string} [message_override] a more actionable message for this occurrence
     * @param {object} [details] structured context for logging - never rendered to clients
     */
    constructor({ code, message }, message_override, details) {
        super(message_override || message);
        this.name = 'S3TablesError';
        this.code = code;
        this.details = details;
    }

}

S3TablesError.InvalidRequest = Object.freeze({
    code: 'InvalidRequest',
    message: 'The request is malformed or failed validation.',
});
S3TablesError.UnsupportedOperation = Object.freeze({
    code: 'UnsupportedOperation',
    message: 'The requested operation is not supported.',
});
S3TablesError.AccessDenied = Object.freeze({
    code: 'AccessDenied',
    message: 'You do not have permission to perform this action.',
});
S3TablesError.TableBucketNotFound = Object.freeze({
    code: 'TableBucketNotFound',
    message: 'The specified table bucket does not exist.',
});
S3TablesError.NamespaceNotFound = Object.freeze({
    code: 'NamespaceNotFound',
    message: 'The specified namespace does not exist.',
});
S3TablesError.TableNotFound = Object.freeze({
    code: 'TableNotFound',
    message: 'The specified table does not exist.',
});
S3TablesError.AlreadyExists = Object.freeze({
    code: 'AlreadyExists',
    message: 'The specified resource already exists.',
});
S3TablesError.TableBucketNotEmpty = Object.freeze({
    code: 'TableBucketNotEmpty',
    message: 'The table bucket you tried to delete is not empty.',
});
S3TablesError.NamespaceNotEmpty = Object.freeze({
    code: 'NamespaceNotEmpty',
    message: 'The namespace you tried to delete is not empty.',
});
S3TablesError.CommitConflict = Object.freeze({
    code: 'CommitConflict',
    message: 'The commit lost a race against a concurrent commit. Reload the table and retry.',
});
S3TablesError.RequirementFailed = Object.freeze({
    code: 'RequirementFailed',
    message: 'A commit requirement is not satisfied. Reload the table and retry.',
});
S3TablesError.TransientFailure = Object.freeze({
    code: 'TransientFailure',
    message: 'The request failed before anything was committed. Retry.',
});
S3TablesError.MetadataIntegrity = Object.freeze({
    code: 'MetadataIntegrity',
    message: 'The table metadata file was modified outside the catalog.',
});
S3TablesError.Throttled = Object.freeze({
    code: 'Throttled',
    message: 'The request was denied due to request throttling.',
});
S3TablesError.CommitStateUnknown = Object.freeze({
    code: 'CommitStateUnknown',
    message: 'The commit was issued and its result was not observed. The commit state is unknown.',
});

/** @param {string} [msg] @param {object} [details] */
const invalid_request = (msg, details) => new S3TablesError(S3TablesError.InvalidRequest, msg, details);
/** @param {string} [msg] @param {object} [details] */
const unsupported_operation = (msg, details) => new S3TablesError(S3TablesError.UnsupportedOperation, msg, details);
/** @param {string} [msg] @param {object} [details] */
const access_denied = (msg, details) => new S3TablesError(S3TablesError.AccessDenied, msg, details);
/** @param {string} [msg] @param {object} [details] */
const table_bucket_not_found = (msg, details) => new S3TablesError(S3TablesError.TableBucketNotFound, msg, details);
/** @param {string} [msg] @param {object} [details] */
const namespace_not_found = (msg, details) => new S3TablesError(S3TablesError.NamespaceNotFound, msg, details);
/** @param {string} [msg] @param {object} [details] */
const table_not_found = (msg, details) => new S3TablesError(S3TablesError.TableNotFound, msg, details);
/** @param {string} [msg] @param {object} [details] */
const already_exists = (msg, details) => new S3TablesError(S3TablesError.AlreadyExists, msg, details);
/** @param {string} [msg] @param {object} [details] */
const table_bucket_not_empty = (msg, details) => new S3TablesError(S3TablesError.TableBucketNotEmpty, msg, details);
/** @param {string} [msg] @param {object} [details] */
const namespace_not_empty = (msg, details) => new S3TablesError(S3TablesError.NamespaceNotEmpty, msg, details);
/** @param {string} [msg] @param {object} [details] */
const commit_conflict = (msg, details) => new S3TablesError(S3TablesError.CommitConflict, msg, details);
/** @param {string} [msg] @param {object} [details] */
const requirement_failed = (msg, details) => new S3TablesError(S3TablesError.RequirementFailed, msg, details);
/** @param {string} [msg] @param {object} [details] */
const transient_failure = (msg, details) => new S3TablesError(S3TablesError.TransientFailure, msg, details);
/** @param {string} [msg] @param {object} [details] */
const metadata_integrity = (msg, details) => new S3TablesError(S3TablesError.MetadataIntegrity, msg, details);
/** @param {string} [msg] @param {object} [details] */
const throttled = (msg, details) => new S3TablesError(S3TablesError.Throttled, msg, details);
/** @param {string} [msg] @param {object} [details] */
const commit_state_unknown = (msg, details) => new S3TablesError(S3TablesError.CommitStateUnknown, msg, details);

// EXPORTS
exports.S3TablesError = S3TablesError;
exports.invalid_request = invalid_request;
exports.unsupported_operation = unsupported_operation;
exports.access_denied = access_denied;
exports.table_bucket_not_found = table_bucket_not_found;
exports.namespace_not_found = namespace_not_found;
exports.table_not_found = table_not_found;
exports.already_exists = already_exists;
exports.table_bucket_not_empty = table_bucket_not_empty;
exports.namespace_not_empty = namespace_not_empty;
exports.commit_conflict = commit_conflict;
exports.requirement_failed = requirement_failed;
exports.transient_failure = transient_failure;
exports.metadata_integrity = metadata_integrity;
exports.throttled = throttled;
exports.commit_state_unknown = commit_state_unknown;
