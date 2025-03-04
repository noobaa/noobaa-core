/* Copyright (C) 2016 NooBaa */
'use strict';

const config = require('../../config');
const NoobaaEvent = require('../manage_nsfs/manage_nsfs_events_utils').NoobaaEvent;

// by default NC_DISABLE_POSIX_MODE_ACCESS_CHECK=true, therefore CLI access check of account/bucket will be based on stat (open file)
// which checks only read permissions. 
const CLI_ACCESS_CHECK_PERMISSIONS = config.NC_DISABLE_POSIX_MODE_ACCESS_CHECK ? 'read' : 'read & write';

/**
 * @typedef {{
 *      code?: string, 
 *      message: string, 
 *      http_code: number,
 *      detail: string,
 *      cause?: Error  
 * }} ManageCLIErrorSpec
 */

class ManageCLIError extends Error {

    /**
     * @param {ManageCLIErrorSpec} error_spec 
     */
    constructor({ code, message, http_code, detail, cause }) {
        super(message, { cause });
        this.code = code;
        this.http_code = http_code;
        this.detail = detail;
    }

    to_string() {
        const json = {
            error: {
                code: this.code,
                message: this.message,
                detail: this.detail,
                cause: this.cause?.stack || this.cause?.message
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

ManageCLIError.InvalidDiagnoseAction = Object.freeze({
    code: 'InvalidDiagnoseAction',
    message: 'Invalid action, available actions are health, gather-logs and metrics',
    http_code: 400,
});

ManageCLIError.InvalidArgument = Object.freeze({
    code: 'InvalidArgument',
    message: 'Invalid argument',
    http_code: 400,
});

ManageCLIError.InvalidArgumentType = Object.freeze({
    code: 'InvalidArgumentType',
    message: 'Invalid argument type',
    http_code: 400,
});

ManageCLIError.UnsetArgumentIsInvalid = Object.freeze({
    code: 'UnsetArgumentIsInvalid',
    message: 'Argument can not be unset or it was unset incorrectly, its value must be set or unset correctly or check there are no leading spaces',
    http_code: 400,
});

ManageCLIError.InvalidType = Object.freeze({
    code: 'InvalidType',
    message: 'Invalid type, available types are account, bucket, logging, whitelist, upgrade, notification or connection.',
    http_code: 400,
});

ManageCLIError.MissingConfigDirPath = Object.freeze({
    code: 'MissingConfigDirPath',
    message: 'Config dir path should not be empty',
    http_code: 400,
});

ManageCLIError.InvalidSchema = Object.freeze({
    code: 'InvalidSchema',
    message: 'Schema invalid, please use required properties',
    http_code: 400,
});

ManageCLIError.InvalidFilePath = Object.freeze({
    code: 'InvalidFilePath',
    message: 'Invalid file path',
    http_code: 400,
});

ManageCLIError.InvalidJSONFile = Object.freeze({
    code: 'InvalidJSONFile',
    message: 'Invalid JSON file',
    http_code: 400,
});

ManageCLIError.MissingUpdateProperty = Object.freeze({
    code: 'MissingUpdateProperty',
    message: 'Should have at least one property to update',
    http_code: 400,
});

ManageCLIError.InvalidFlagsCombination = Object.freeze({
    code: 'InvalidFlagsCombination',
    message: 'The flags combination that you used is invalid',
    http_code: 400,
});

ManageCLIError.InvalidAccountName = Object.freeze({
    code: 'InvalidAccountName',
    message: 'Account name is invalid',
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

ManageCLIError.InvalidMasterKey = Object.freeze({
    code: 'InvalidMasterKey',
    message: 'Master key manager had issues loading master key, can not decrypt/encrypt secrets.',
    http_code: 500,
});

//////////////////////////////
//// BUCKET LOGGING ERRORS ///
//////////////////////////////

ManageCLIError.LoggingExportFailed = Object.freeze({
    code: 'LoggingExportFailed',
    message: 'Logging export attmept failed',
});

//////////////////////////////
/////// METRICS ERRORS ///////
//////////////////////////////

ManageCLIError.MetricsStatusFailed = Object.freeze({
    code: 'MetricsStatusFailed',
    message: 'Metrics fetch request failed',
    http_code: 500,
});

//////////////////////////////
//////// HEALTH ERRORS ///////
//////////////////////////////

ManageCLIError.HealthStatusFailed = Object.freeze({
    code: 'HealthStatusFailed',
    message: 'Health status request failed',
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

ManageCLIError.AccountDeleteForbiddenHasBuckets = Object.freeze({
    code: 'AccountDeleteForbiddenHasBuckets',
    message: 'Cannot delete account that is owner of buckets. ' +
        'You must delete all buckets before deleting the account',
    http_code: 403,
});

ManageCLIError.AccountDeleteForbiddenHasIAMAccounts = Object.freeze({
    code: 'AccountDeleteForbiddenHasIAMAccounts',
    message: 'Cannot delete account that is owner of IAM accounts. ' +
        'You must delete all IAM accounts before deleting the root account',
    http_code: 403,
});

ManageCLIError.AccountCannotCreateRootAccountsRequesterIAMUser = Object.freeze({
    code: 'AccountCannotCreateRootAccounts',
    message: 'Cannot update account to have iam_operate_on_root_account. ' +
        'You must use root account for this action',
    http_code: 409,
});

ManageCLIError.AccountCannotBeRootAccountsManager = Object.freeze({
    code: 'AccountCannotBeRootAccountsManager',
    message: 'Cannot update account to have iam_operate_on_root_account. ' +
        'You must delete all IAM accounts before update or ' +
        'use root accounts that does not owns any IAM accounts',
    http_code: 409,
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

ManageCLIError.InvalidAccountSecretKeyFlag = Object.freeze({
    code: 'InvalidAccountSecretKeyFlag',
    message: 'Account secret length must be 40, and must contain only alpha-numeric chars, "+", "/"',
    http_code: 400,
});

ManageCLIError.InvalidAccountAccessKeyFlag = Object.freeze({
    code: 'InvalidAccountAccessKeyFlag',
    message: 'Account access key length must be 20, and must contain only alpha-numeric chars',
    http_code: 400,
});

ManageCLIError.MissingAccountNameFlag = Object.freeze({
    code: 'MissingAccountNameFlag',
    message: 'Account name is mandatory, please use the --name flag',
    http_code: 400,
});

ManageCLIError.MissingIdentifier = Object.freeze({
    code: 'MissingIdentifier',
    message: 'Account identifier is mandatory, please use the --access_key or --name flag',
    http_code: 400,
});

ManageCLIError.InvalidAccountNSFSConfig = Object.freeze({
    code: 'InvalidAccountNSFSConfig',
    message: 'Account config should not be empty, should contain UID, GID or user',
    http_code: 400,
});

ManageCLIError.MissingAccountNSFSConfigUID = Object.freeze({
    code: 'MissingAccountNSFSConfigUID',
    message: 'Account config should include UID',
    http_code: 400,
});

ManageCLIError.MissingAccountNSFSConfigGID = Object.freeze({
    code: 'MissingAccountNSFSConfigGID',
    message: 'Account config should include GID',
    http_code: 400,
});

ManageCLIError.InvalidAccountNewBucketsPath = Object.freeze({
    code: 'InvalidAccountNewBucketsPath',
    message: 'Account\'s new_buckets_path should be a valid and existing directory path',
    http_code: 400,
});

ManageCLIError.InvalidBooleanValue = Object.freeze({
    code: 'InvalidBooleanValue',
    message: 'supported values are true and false',
    http_code: 400,
});

ManageCLIError.InaccessibleAccountNewBucketsPath = Object.freeze({
    code: 'InaccessibleAccountNewBucketsPath',
    message: `Account should have ${CLI_ACCESS_CHECK_PERMISSIONS} access to the specified new_buckets_path`,
    http_code: 400,
});

ManageCLIError.InvalidAccountDistinguishedName = Object.freeze({
    code: 'InvalidAccountDistinguishedName',
    message: 'Account distinguished name was not found',
    http_code: 400,
});
ManageCLIError.InvalidGlacierOperation = Object.freeze({
    code: 'InvalidGlacierOperation',
    message: 'only "migrate", "restore" and "expiry" subcommands are supported',
    http_code: 400,
});
ManageCLIError.InvalidSupplementalGroupsList = Object.freeze({
    code: 'InvalidSupplementalGroupsList',
    message: 'supplemental groups must be a list of group ids (group id is zero or a positive integer)',
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

ManageCLIError.BucketSetForbiddenBucketOwnerNotExists = Object.freeze({
    code: 'BucketSetForbiddenBucketOwnerNotExists',
    message: 'The bucket owner you set for the bucket does not exist. ' +
        'Please set the bucket owner from existing account',
    http_code: 403,
});

ManageCLIError.BucketSetForbiddenBucketOwnerIsIAMAccount = Object.freeze({
    code: 'BucketSetForbiddenBucketOwnerIsIAMAccount',
    message: 'The bucket owner you set for the bucket is an IAM account. ' +
        'Please set root account as bucket owner',
    http_code: 403,
});

ManageCLIError.BucketCreationNotAllowed = Object.freeze({
    code: 'BucketCreationNotAllowed',
    message: 'Not allowed to create new buckets',
    http_code: 403,
});

ManageCLIError.BucketDeleteForbiddenHasObjects = Object.freeze({
    code: 'BucketDeleteForbiddenHasObjects',
    message: 'Cannot delete non-empty bucket. ' +
    'You must delete all object before deleting the bucket or use --force flag',
    http_code: 403,
});

/////////////////////////////////
//// BUCKET ARGUMENTS ERRORS ////
/////////////////////////////////


ManageCLIError.MissingBucketNameFlag = Object.freeze({
    code: 'MissingBucketNameFlag',
    message: 'Bucket name is mandatory, please use the --name flag',
    http_code: 400,
});

ManageCLIError.MissingBucketOwnerFlag = Object.freeze({
    code: 'MissingBucketOwnerFlag',
    message: 'Bucket owner (account name) is mandatory, please use the --owner flag',
    http_code: 400,
});

ManageCLIError.MissingBucketPathFlag = Object.freeze({
    code: 'MissingBucketPathFlag',
    message: 'Bucket path is mandatory, please use the --path flag',
    http_code: 400,
});

ManageCLIError.InvalidFSBackend = Object.freeze({
    code: 'InvalidFSBackend',
    message: 'FS backend supported types are GPFS, CEPH_FS, NFSv4 default is POSIX',
    http_code: 400,
});

ManageCLIError.MalformedPolicy = Object.freeze({
    code: 'MalformedPolicy',
    message: 'Invalid bucket policy',
    http_code: 400,
});

ManageCLIError.InaccessibleStoragePath = Object.freeze({
    code: 'InaccessibleStoragePath',
    message: `Bucket owner should have ${CLI_ACCESS_CHECK_PERMISSIONS} access to the specified bucket storage path`,
    http_code: 400,
});

ManageCLIError.BucketNotEmpty = Object.freeze({
    code: 'BucketNotEmpty',
    message: 'The bucket you tried to delete is not empty. You must delete all versions in the bucket',
    http_code: 400,
});


///////////////////////////////
//      UPGRADE ERRORS       //
///////////////////////////////

ManageCLIError.InvalidUpgradeAction = Object.freeze({
    code: 'InvalidUpgradeAction',
    message: 'Invalid Upgrade action',
    http_code: 400,
});

ManageCLIError.UpgradeFailed = Object.freeze({
    code: 'UpgradeFailed',
    message: 'Upgrade request failed',
    http_code: 500,
});

ManageCLIError.UpgradeStatusFailed = Object.freeze({
    code: 'UpgradeStatusFailed',
    message: 'Upgrade status request failed',
    http_code: 500,
});

ManageCLIError.UpgradeHistoryFailed = Object.freeze({
    code: 'UpgradeHistoryFailed',
    message: 'Upgrade history request failed',
    http_code: 500,
});

ManageCLIError.ConfigDirUpdateBlocked = Object.freeze({
    code: 'ConfigDirUpdateBlocked',
    message: 'Config directory updates are not allowed on mismatch of the config directory version mentioned in system.json and the config directory version of the source code',
    http_code: 500,
});

///////////////////////////////
//     CONNECTION ERRORS     //
///////////////////////////////

ManageCLIError.MissingCliParam = Object.freeze({
    code: 'MissingCliParam',
    message: 'Required cli parameter is missing.',
    http_code: 400,
});

ManageCLIError.ConnectionAlreadyExists = Object.freeze({
    code: 'ConnectionAlreadyExists',
    message: 'The requested connection name is not available. Please select a different name and try again.',
    http_code: 409,
});

ManageCLIError.NoSuchConnection = Object.freeze({
    code: 'NoSuchConnection',
    message: 'Connection does not exist.',
    http_code: 404,
});

//////////////////////////////
//     LIFECYCLE ERRORS     //
//////////////////////////////

ManageCLIError.SystemJsonIsMissing = Object.freeze({
    code: 'SystemJsonIsMissing',
    message: 'Lifecycle worker can not run when system.json is missing.',
    http_code: 400,
});

ManageCLIError.NooBaaServiceIsNotActive = Object.freeze({
    code: 'NooBaaServiceIsNotActive',
    message: 'Lifecycle worker can not run when NooBaa service is not active.',
    http_code: 400,
});

///////////////////////////////
//       ERRORS MAPPING      //
///////////////////////////////


ManageCLIError.FS_ERRORS_TO_MANAGE = Object.freeze({
    EACCES: ManageCLIError.AccessDenied,
    EPERM: ManageCLIError.AccessDenied,
    EINVAL: ManageCLIError.InvalidRequest,
    NOT_IMPLEMENTED: ManageCLIError.NotImplemented,
    INTERNAL_ERROR: ManageCLIError.InternalError,
    // ENOENT: ManageCLIError.NoSuchBucket,
    NOT_EMPTY: ManageCLIError.BucketNotEmpty,
    MALFORMED_POLICY: ManageCLIError.MalformedPolicy,
    // EEXIST: ManageCLIError.BucketAlreadyExists,
});

ManageCLIError.RPC_ERROR_TO_MANAGE = Object.freeze({
    INVALID_SCHEMA: ManageCLIError.InvalidSchema,
    NO_SUCH_USER: ManageCLIError.InvalidAccountDistinguishedName,
    INVALID_MASTER_KEY: ManageCLIError.InvalidMasterKey,
    INVALID_BUCKET_NAME: ManageCLIError.InvalidBucketName,
    CONFIG_DIR_VERSION_MISMATCH: ManageCLIError.ConfigDirUpdateBlocked
});

const NSFS_CLI_ERROR_EVENT_MAP = {
    WhiteListIPUpdateFailed: NoobaaEvent.WHITELIST_UPDATED_FAILED,
    AccessDenied: NoobaaEvent.UNAUTHORIZED,
    AccountAccessKeyAlreadyExists: NoobaaEvent.ACCOUNT_ALREADY_EXISTS,
    AccountNameAlreadyExists: NoobaaEvent.ACCOUNT_ALREADY_EXISTS,
    AccountDeleteForbiddenHasBuckets: NoobaaEvent.ACCOUNT_DELETE_FORBIDDEN,
    BucketAlreadyExists: NoobaaEvent.BUCKET_ALREADY_EXISTS,
    BucketSetForbiddenBucketOwnerNotExists: NoobaaEvent.UNAUTHORIZED, // GAP - add event
    BucketSetForbiddenBucketOwnerIsIAMAccount: NoobaaEvent.UNAUTHORIZED, // // GAP - add event
    LoggingExportFailed: NoobaaEvent.LOGGING_FAILED,
    UpgradeFailed: NoobaaEvent.CONFIG_DIR_UPGRADE_FAILED
};

exports.ManageCLIError = ManageCLIError;
exports.NSFS_CLI_ERROR_EVENT_MAP = NSFS_CLI_ERROR_EVENT_MAP;
