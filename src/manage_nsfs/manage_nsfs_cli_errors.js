/* Copyright (C) 2016 NooBaa */
'use strict';

/**
 * @typedef {{
 *      code?: string, 
 *      message: string, 
 *      http_code: number,
 * }} ManageCLIErrorSpec
 */

class ManageCLIError extends Error {

    /**
     * @param {ManageCLIErrorSpec} error_spec 
     */
    constructor({ code, message, http_code }) {
        super(message); // sets this.message
        this.code = code;
        this.http_code = http_code;
    }

    to_string(detail) {
        const json = {
            error: {
                code: this.code,
                message: this.message,
                detail: detail
            }
        };
        return JSON.stringify(json, null, 2);
    }
}

// See Manage NSFS CLI error codes docs - TODO: add docs

////////////////////////
//// GENERAL ERRORS ////
////////////////////////


ManageCLIError.InternalError = Object.freeze({
    code: 'InternalError',
    message: 'The server encountered an internal error. Please retry the request',
    http_code: 500,
});

ManageCLIError.InvalidRequest = Object.freeze({
    code: 'InvalidRequest',
    message: 'The request is invalid',
    http_code: 400,
});

ManageCLIError.NotImplemented = Object.freeze({
    code: 'NotImplemented',
    message: 'functionality is not implemented.',
    http_code: 501,
});

ManageCLIError.InvalidAction = Object.freeze({
    code: 'InvalidAction',
    message: 'Invalid action, available actions are add, status, update, delete, list',
    http_code: 400,
});
ManageCLIError.InvalidConfigType = Object.freeze({
    code: 'InvalidConfigType',
    message: 'Invalid config type, available config types are account, bucket or whitelist',
    http_code: 400,
});
ManageCLIError.MissingConfigDirPath = Object.freeze({
    code: 'MissingConfigDirPath',
    message: 'Config dir path should not be empty',
    http_code: 400,
});

//////////////////////////////
//// IP WHITE LIST ERRORS ////
//////////////////////////////

ManageCLIError.MissingWhiteListIPFlag = Object.freeze({
    code: 'MissingWhiteListIPFlag',
    message: 'Whitelist ips are mandatory, please use the --ips flag',
    http_code: 400,
});

ManageCLIError.InvalidWhiteListIPFormat = Object.freeze({
    code: 'InvalidWhiteListIPFormat',
    message: 'Whitelist IP body format is invalid',
    http_code: 400,
});

ManageCLIError.WhiteListIPUpdateFailed = Object.freeze({
    code: 'WhiteListIPUpdateFailed',
    message: 'Whitelist ip update failed',
    http_code: 500,
});

////////////////////////
//// ACCOUNT ERRORS ////
////////////////////////

ManageCLIError.AccessDenied = Object.freeze({
    code: 'AccessDenied',
    message: 'Account has no permissions to access the bucket',
    http_code: 403,
});

ManageCLIError.NoSuchAccountAccessKey = Object.freeze({
    code: 'NoSuchAccountAccessKey',
    message: 'Account does not exist - access key',
    http_code: 404,
});

ManageCLIError.NoSuchAccountName = Object.freeze({
    code: 'NoSuchAccountName',
    message: 'Account does not exist - name',
    http_code: 404,
});

ManageCLIError.AccountAccessKeyAlreadyExists = Object.freeze({
    code: 'AccountAccessKeyAlreadyExists',
    message: 'Account already exists - access_key',
    http_code: 409,
});

ManageCLIError.AccountNameAlreadyExists = Object.freeze({
    code: 'AccountNameAlreadyExists',
    message: 'Account already exists - name',
    http_code: 409,
});

ManageCLIError.AccountAccessKeyAndNameMismatch = Object.freeze({
    code: 'AccountAccessKeyAndNameMismatch',
    message: 'Account access key and name mismatch',
    http_code: 403,
});

//////////////////////////////////
//// ACCOUNT ARGUMENTS ERRORS ////
//////////////////////////////////

ManageCLIError.MissingAccountSecretKeyFlag = Object.freeze({
    code: 'MissingAccountSecretKeyFlag',
    message: 'Account secret key is mandatory, please use the --secret_key flag or --regenerate on update',
    http_code: 400,
});

ManageCLIError.MissingAccountAccessKeyFlag = Object.freeze({
    code: 'MissingAccountAccessKeyFlag',
    message: 'Account access key is mandatory, please use the --access_key flag or --regenerate on update on update',
    http_code: 400,
});

ManageCLIError.AccountSecretKeyFlagComplexity = Object.freeze({
    code: 'AccountSecretKeyFlagComplexity',
    message: 'Account secret length must be 40, and must contain uppercase, lowercase, numbers and symbols',
    http_code: 400,
});

ManageCLIError.AccountAccessKeyFlagComplexity = Object.freeze({
    code: 'AccountAccessKeyFlagComplexity',
    message: 'Account access key length must be 20, and must contain uppercase and numbers',
    http_code: 400,
});

ManageCLIError.NewAccountAccessKeyFlagComplexity = Object.freeze({
    code: 'NewAccountAccessKeyFlagComplexity',
    message: 'Account new access key length must be 20, and must contain uppercase and numbers',
    http_code: 400,
});

ManageCLIError.MissingAccountNameFlag = Object.freeze({
    code: 'MissingAccountNameFlag',
    message: 'Account name is mandatory, please use the --name flag',
    http_code: 400,
});

ManageCLIError.MissingAccountEmailFlag = Object.freeze({
    code: 'MissingAccountEmailFlag',
    message: 'Account email is mandatory, please use the --email flag',
    http_code: 400,
});

ManageCLIError.MissingIdentifier = Object.freeze({
    code: 'MissingIdentifier',
    message: 'Account identifier is mandatory, please use the --acces_key or --name flag',
    http_code: 400,
});

ManageCLIError.InvalidAccountNSFSConfig = Object.freeze({
    code: 'InvalidAccountNSFSConfig',
    message: 'Account config should not be empty',
    http_code: 400,
});

ManageCLIError.InvalidAccountNewBucketsPath = Object.freeze({
    code: 'InvalidAccountNewBucketsPath',
    message: 'Account\'s new_buckets_path should be a valid and existing directory path',
    http_code: 400,
});

ManageCLIError.InvalidAccountUID = Object.freeze({
    code: 'InvalidAccountUID',
    message: 'Account UID must be a number',
    http_code: 400,
});

ManageCLIError.InvalidAccountGID = Object.freeze({
    code: 'InvalidAccountGID',
    message: 'Account GID must be a number',
    http_code: 400,
});

ManageCLIError.InvalidNewNameAccountIdentifier = Object.freeze({
    code: 'InvalidNewNameAccountIdentifier',
    message: 'Account new_name can not be used on add command, please remove the --new_name flag',
    http_code: 400,
});

ManageCLIError.InvalidNewAccessKeyIdentifier = Object.freeze({
    code: 'InvalidNewAccessKeyIdentifier',
    message: 'Account new_access_key can not be used on add command, please remove the --new_access_key flag',
    http_code: 400,
});


////////////////////////
//// BUCKET ERRORS /////
////////////////////////

ManageCLIError.NoSuchBucket = Object.freeze({
    code: 'NoSuchBucket',
    message: 'Bucket does not exist',
    http_code: 404,
});

ManageCLIError.InvalidBucketName = Object.freeze({
    code: 'InvalidBucketName',
    message: 'The specified bucket name is not valid.',
    http_code: 400,
});

ManageCLIError.InvalidStoragePath = Object.freeze({
    code: 'InvalidStoragePath',
    message: 'The specified bucket storage path is not valid.',
    http_code: 400,
});

ManageCLIError.BucketAlreadyExists = Object.freeze({
    code: 'BucketAlreadyExists',
    message: 'The requested bucket name is not available. The bucket namespace is shared by all users of the system. Please select a different name and try again.',
    http_code: 409,
});

/////////////////////////////////
//// BUCKET ARGUMENTS ERRORS ////
/////////////////////////////////


ManageCLIError.MissingBucketNameFlag = Object.freeze({
    code: 'MissingBucketNameFlag',
    message: 'Bucket name is mandatory, please use the --name flag',
    http_code: 400,
});

ManageCLIError.MissingBucketEmailFlag = Object.freeze({
    code: 'MissingBucketEmailFlag',
    message: 'Bucket email is mandatory, please use the --email flag',
    http_code: 400,
});

ManageCLIError.MissingBucketPathFlag = Object.freeze({
    code: 'MissingBucketPathFlag',
    message: 'Bucket path is mandatory, please use the --path flag',
    http_code: 400,
});

ManageCLIError.InvalidNewNameBucketIdentifier = Object.freeze({
    code: 'InvalidNewNameBucketIdentifier',
    message: 'Bucket new_name can not be used on add command, please remove the --new_name flag',
    http_code: 400,
});

ManageCLIError.InvalidFSBackend = Object.freeze({
    code: 'InvalidFSBackend',
    message: 'FS backend supported types is GPFS, default is POSIX',
    http_code: 400,
});

ManageCLIError.FS_ERRORS_TO_MANAGE = Object.freeze({
    EACCES: ManageCLIError.AccessDenied,
    EPERM: ManageCLIError.AccessDenied,
    EINVAL: ManageCLIError.InvalidRequest,
    NOT_IMPLEMENTED: ManageCLIError.NotImplemented,
    INTERNAL_ERROR: ManageCLIError.InternalError,
    // ENOENT: ManageCLIError.NoSuchBucket,
    // NOT_EMPTY: ManageCLIError.BucketNotEmpty,
    // MALFORMED_POLICY: ManageCLIError.MalformedPolicy,
    // EEXIST: ManageCLIError.BucketAlreadyExists,
});

exports.ManageCLIError = ManageCLIError;
