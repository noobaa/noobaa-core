/* Copyright (C) 2016 NooBaa */
'use strict';

const dbg = require('../util/debug_module')(__filename);
const _ = require('lodash');


/**
* @typedef {{
*       event_code?: string, 
*       entity_type: string,
*       event_type: string, 
*       message: string,
*       description: string, 
*       scope: string,
*       severity: string,      
*       state: string,
* }} NoobaaEventSpec
*/
    class NoobaaEvent {
        /**
         * @param {NoobaaEventSpec} event_spec 
         */
        constructor({ event_code, entity_type, event_type, message, description, scope, severity, state}) {
            this.event_code = event_code;
            this.entity_type = entity_type;
            this.event_type = event_type;
            this.message = message;
            this.description = description;
            this.scope = scope;
            this.severity = severity;
            this.state = state;
        }
        create_event(name, arg = undefined, err = undefined) {
            const description = this.description + (err ? ', error: ' + err : '');
            const message = this.message + (name ? ', value: ' + name : '');
            dbg.event(_.omitBy({
                code: this.event_code,
                message: message,
                description: description,
                entity_type: this.entity_type,
                event_type: this.event_type,
                scope: this.scope,
                severity: this.severity,
                state: this.state,
                arguments: arg,
            }, _.isUndefined));
        }
    }

NoobaaEvent.FORK_EXIT = Object.freeze({
    event_code: 'noobaa_fork_exit',
    entity_type: 'NODE',
    event_type: 'STATE_CHANGE',
    message: 'Noobaa fork exited',
    description: 'Noobaa fork exited due to internal error',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'DEGRADED',
});
NoobaaEvent.NOOBAA_STARTED = Object.freeze({
    event_code: 'noobaa_started',
    entity_type: 'NODE',
    event_type: 'STATE_CHANGE',
    message: 'Noobaa started',
    description: 'Noobaa started running',
    scope: 'NODE',
    severity: 'INFO',
    state: 'HEALTHY'
});
NoobaaEvent.ENDPOINT_CRASHED = Object.freeze({
    event_code: 'noobaa_endpoint_crashed',
    entity_type: 'NODE',
    event_type: 'STATE_CHANGE',
    message: 'Noobaa crashed',
    description: 'Noobaa crashed due internal error, ',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'STOPPED'
});
NoobaaEvent.GPFSLIB_MISSING = Object.freeze({
    event_code: 'noobaa_gpfslib_missing',
    entity_type: 'NODE',
    event_type: 'STATE_CHANGE',
    message: 'Noobaa GPFS library file is missing',
    description: 'Noobaa GPFS library file is missing',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'DEGRADED',
});
NoobaaEvent.S3_CRASHED = Object.freeze({
    event_code: 'noobaa_s3_crashed',
    entity_type: 'NODE',
    event_type: 'STATE_CHANGE',
    message: 'Noobaa S3 crashed',
    description: 'Noobaa S3 crashed',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'STOPPED'
});
NoobaaEvent.WHITELIST_UPDATED = Object.freeze({
    event_code: 'noobaa_whitelist_updated',
    entity_type: 'NODE',
    event_type: 'INFO',
    message: 'Whitelist updated with IPs.',
    description: 'Whitelist updated with IPs.',
    scope: 'NODE',
    severity: 'INFO',
    state: 'HEALTHY',
});
NoobaaEvent.WHITELIST_UPDATED_FAILED = Object.freeze({
    event_code: 'noobaa_whitelist_updated_failed',
    entity_type: 'NODE',
    event_type: 'INFO',
    message: 'Whitelist updated with IPs failed.',
    description: 'Whitelist updated with IPs failed. Error while updation config.json file with whitelist IPs',
    scope: 'NODE',
    severity: 'INFO',
    state: 'DEGRADED',
});
NoobaaEvent.INTERNAL_ERROR = Object.freeze({
    event_code: 'noobaa_internal_error',
    message: 'Noobaa action failed with internal error',
    description: 'Noobaa action failed with internal error',
    entity_type: 'NODE',
    event_type: 'ERROR',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'HEALTHY',
});

NoobaaEvent.ACCOUNT_NOT_FOUND = Object.freeze({
    event_code: 'noobaa_account_not_found',
    entity_type: 'NODE',
    event_type: 'INFO',
    message: 'Account with access_key not found in system. Please check access_key',
    description: 'Account with access_key not found in system. Please check access_key',
    scope: 'NODE',
    severity: 'INFO',
    state: 'HEALTHY'
});
NoobaaEvent.ACCOUNT_DELETED = Object.freeze({
    event_code: 'noobaa_account_deleted',
    entity_type: 'NODE',
    event_type: 'INFO',
    message: 'Account deleted',
    description: 'Noobaa Account deleted',
    scope: 'NODE',
    severity: 'INFO',
    state: 'HEALTHY',
});
NoobaaEvent.ACCOUNT_CREATED = Object.freeze({
    event_code: 'noobaa_account_created',
    entity_type: 'NODE',
    event_type: 'INFO',
    message: 'Account created',
    description: 'Noobaa Account created',
    scope: 'NODE',
    severity: 'INFO',
    state: 'HEALTHY',
});
NoobaaEvent.ACCOUNT_ALREADY_EXISTS = Object.freeze({
    event_code: 'noobaa_account_exists',
    entity_type: 'NODE',
    event_type: 'INFO',
    message: 'Noobaa acount with name/access key already exists in system',
    description: 'Noobaa acount with name/access key already exists in system, please verify the existing account name/access_key',
    scope: 'NODE',
    severity: 'INFO',
    state: 'HEALTHY'
});
NoobaaEvent.ACCOUNT_DELETE_FORBIDDEN = Object.freeze({
    event_code: 'noobaa_account_delete_forbidden',
    entity_type: 'NODE',
    event_type: 'INFO',
    message: 'Noobaa acount deletion forbidden',
    description: 'Cannot delete account that is owner of buckets. ' +
    'You must delete all buckets before deleting the account',
    scope: 'NODE',
    severity: 'INFO',
    state: 'HEALTHY'
});

NoobaaEvent.OBJECT_GET_FAILED = Object.freeze({
    event_code: 'noobaa_object_get_failed',
    entity_type: 'NODE',
    event_type: 'ERROR',
    message: 'Error while getting object.',
    description: 'Read object stream could not find dir content xattr. ',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'DEGRADED',
});
NoobaaEvent.OBJECT_STREAM_GET_FAILED = Object.freeze({
    event_code: 'noobaa_object_stream_get_failed',
    entity_type: 'NODE',
    event_type: 'ERROR',
    message: 'Error while reading the object',
    description: 'Error while reading the object',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'DEGRADED',
});
NoobaaEvent.OBJECT_CLEANUP_FAILED = Object.freeze({
    event_code: 'noobaa_object_cleanup_failed',
    entity_type: 'NODE',
    event_type: 'ERROR',
    message: 'Error while read object stream clean up for bucket.',
    description: 'Read object stream buffer pool cleanup failes',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'DEGRADED',
});
NoobaaEvent.OBJECT_UPLOAD_FAILED = Object.freeze({
    event_code: 'noobaa_object_upload_failed',
    entity_type: 'NODE',
    event_type: 'ERROR',
    message: 'Error while uploading object',
    description: 'Upload object failed',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'DEGRADED',
});

NoobaaEvent.BUCKET_CREATED = Object.freeze({
    event_code: 'noobaa_bucket_created',
    message: 'Bucket created',
    description: 'Noobaa bucket created',
    entity_type: 'NODE',
    event_type: 'INFO',
    scope: 'NODE',
    severity: 'INFO',
    state: 'HEALTHY',
});
NoobaaEvent.BUCKET_DELETE = Object.freeze({
    event_code: 'noobaa_bucket_deleted',
    message: 'Bucket deleted',
    description: 'Noobaa bucket deleted',
    entity_type: 'NODE',
    event_type: 'INFO',
    scope: 'NODE',
    severity: 'INFO',
    state: 'HEALTHY',
});
NoobaaEvent.BUCKET_CREATION_FAILED = Object.freeze({
    event_code: 'noobaa_bucket_creation_failed',
    entity_type: 'NODE',
    event_type: 'ERROR',
    message: 'Could not create underlying config file',
    description: 'Could not create underlying config file, Check for permission or existing files,',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'DEGRADED',
});
NoobaaEvent.BUCKET_DIR_CREATION_FAILED = Object.freeze({
    event_code: 'noobaa_bucket_dir_creation_failed',
    entity_type: 'NODE',
    event_type: 'ERROR',
    message: 'Could not create underlying bucket directory',
    description: 'Could not create underlying bucket directory, Check for permission and dir path,',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'DEGRADED',
});
NoobaaEvent.BUCKET_DELETE_FAILED = Object.freeze({
    event_code: 'noobaa_bucket_delete_failed',
    entity_type: 'NODE',
    event_type: 'ERROR',
    message: 'Could not delete underlying bucket',
    description: 'Could not create underlying bucket',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'DEGRADED',
});
NoobaaEvent.NO_SUCH_BUCKET = Object.freeze({
    event_code: 'noobaa_no_such_bucket',
    message: 'Bucket not found',
    description: 'Bucket not found',
    entity_type: 'NODE',
    event_type: 'ERROR',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'HEALTHY',
});
NoobaaEvent.BUCKET_ALREADY_EXISTS = Object.freeze({
    event_code: 'noobaa_bucket_already_exists',
    message: 'Bucket already exists with the name',
    description: 'Bucket already exists with the name',
    entity_type: 'NODE',
    event_type: 'ERROR',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'HEALTHY',
});
NoobaaEvent.UNAUTHORIZED = Object.freeze({
    event_code: 'noobaa_bucket_access_unauthorized',
    message: 'Bucket is not accessible with current access rights ',
    description: 'Bucket is not accessible with current access rights',
    entity_type: 'NODE',
    event_type: 'ERROR',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'HEALTHY',
});

NoobaaEvent.IO_STREAM_ITEM_TIMEOUT = Object.freeze({
    event_code: 'bucket_io_stream_item_timeout',
    message: 'Bucket IO sream timeout',
    description: 'Bucket IO sream timeout',
    entity_type: 'NODE',
    event_type: 'ERROR',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'HEALTHY',
});

NoobaaEvent.INVALID_BUCKET_STATE = Object.freeze({
    event_code: 'bucket_invalid_bucket_state',
    message: 'Bucket is in invalid state',
    description: 'Bucket is in invalid state. Bucket schema missing required property or invalid property gets added',
    entity_type: 'NODE',
    event_type: 'ERROR',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'HEALTHY',
});

NoobaaEvent.LOGGING_EXPORTED = Object.freeze({
    event_code: 'bucket_logging_exported',
    entity_type: 'NODE',
    event_type: 'INFO',
    message: 'Bucket logs was exported to target buckets',
    description: 'Bucket logs was successfully exported to target buckets',
    scope: 'NODE',
    severity: 'INFO',
    state: 'HEALTHY',
});

NoobaaEvent.LOGGING_FAILED = Object.freeze({
    event_code: 'bucket_logging_export_failed',
    entity_type: 'NODE',
    event_type: 'ERROR',
    message: 'Bucket logging export failed.',
    description: 'Bucket logging export failed due to error',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'DEGRADED',
});

/////////////////////////////////////
// CONFIG DIRECTORY UPGRADE EVENTS //
/////////////////////////////////////

NoobaaEvent.CONFIG_DIR_UPGRADE_STARTED = Object.freeze({
    event_code: 'config_dir_upgrade_started',
    entity_type: 'NODE',
    event_type: 'INFO',
    message: 'Config directory upgrade started.',
    description: 'Config directory upgrade started.',
    scope: 'NODE',
    severity: 'INFO',
    state: 'HEALTHY',
});

NoobaaEvent.CONFIG_DIR_UPGRADE_SUCCESSFUL = Object.freeze({
    event_code: 'config_dir_upgrade_successful',
    entity_type: 'NODE',
    event_type: 'INFO',
    message: 'Config directory upgrade finished successfully.',
    description: 'Config directory upgrade finished successfully.',
    scope: 'NODE',
    severity: 'INFO',
    state: 'HEALTHY',
});

NoobaaEvent.CONFIG_DIR_UPGRADE_FAILED = Object.freeze({
    event_code: 'config_dir_upgrade_failed',
    entity_type: 'NODE',
    event_type: 'ERROR',
    message: 'Config directory upgrade failed.',
    description: 'Config directory upgrade failed due to an error',
    scope: 'NODE',
    severity: 'ERROR',
    state: 'DEGRADED',
});

exports.NoobaaEvent = NoobaaEvent;
