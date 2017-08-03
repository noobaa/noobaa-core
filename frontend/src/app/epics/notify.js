import { deepFreeze } from 'utils/core-utils';
import { showNotification } from 'action-creators';
import {
    FAIL_CREATE_ACCOUNT,
    COMPLETE_UPDATE_ACCOUNT_S3_ACCESS,
    FAIL_UPDATE_ACCOUNT_S3_ACCESS,
    COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS,
    FAIL_SET_ACCOUNT_IP_RESTRICTIONS,
    COMPLETE_CHANGE_ACCOUNT_PASSWORD,
    FAIL_CHANGE_ACCOUNT_PASSWORD,
    COMPLETE_UPDATE_BUCKET_QUOTA,
    FAIL_UPDATE_BUCKET_QUOTA,
    COMPLETE_ADD_EXTERNAL_CONNECTION,
    FAIL_ADD_EXTERNAL_CONNECTION,
    COMPLETE_DELETE_RESOURCE,
    FAIL_DELETE_RESOURCE,
    COLLECT_HOST_DIAGNOSTICS,
    FAIL_COLLECT_HOST_DIAGNOSTICS
} from 'action-types';

const actionToNotification = deepFreeze({
    [FAIL_CREATE_ACCOUNT]: ({ accountName }) => ({
        message: `Creating account ${accountName} failed`,
        severity: 'error'
    }),

    [COMPLETE_UPDATE_ACCOUNT_S3_ACCESS]: ({ accountName }) => ({
        message: `${accountName} S3 access updated successfully`,
        severity: 'success'
    }),

    [FAIL_UPDATE_ACCOUNT_S3_ACCESS]: ({ accountName }) => ({
        message: `Updating ${accountName} S3 access failed`,
        severity: 'error'
    }),

    [COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS]: ({ accountName }) => ({
        message: `IP restrictions for ${accountName} set successfully`,
        severity: 'success'
    }),

    [FAIL_SET_ACCOUNT_IP_RESTRICTIONS]: ({ accountName }) => ({
        message: `Setting IP restrictions for ${accountName} failed`,
        severity: 'error'
    }),

    [COMPLETE_CHANGE_ACCOUNT_PASSWORD]: ({ accountName }) => ({
        message: `${accountName} password changed successfully`,
        severity: 'success'
    }),

    [FAIL_CHANGE_ACCOUNT_PASSWORD]: ({ accountName }) => ({
        message: `Changing ${accountName} password failed`,
        severity: 'error'
    }),

    [COMPLETE_UPDATE_BUCKET_QUOTA]: ({ bucket }) => ({
        message: `${bucket} quota updated successfully`,
        severity: 'success'
    }),

    [FAIL_UPDATE_BUCKET_QUOTA]: ({ bucket }) => ({
        message: `Updating quota for ${bucket} failed`,
        severity: 'error'
    }),

    [COMPLETE_ADD_EXTERNAL_CONNECTION]: ({ connection }) => ({
        message: `Adding ${connection} completed successfully`,
        severity: 'success'
    }),

    [FAIL_ADD_EXTERNAL_CONNECTION]: ({ connection }) => ({
        message: `Adding ${connection} failed`,
        severity: 'error'
    }),

    [COMPLETE_DELETE_RESOURCE]: ({ resource }) => ({
        message: `Resource ${resource} deleted successfully`,
        severity: 'success'
    }),

    [FAIL_DELETE_RESOURCE]: ({ resource }) => ({
        message: `Resource ${resource} deletion failed`,
        severity: 'error'
    }),

    [COLLECT_HOST_DIAGNOSTICS]: ({ host }) => ({
        message: `Collecting diagnostic for ${host}, it may take a few seconds`,
        severity: 'success'
    }),

    [FAIL_COLLECT_HOST_DIAGNOSTICS]: ({ host }) => ({
        message: `Collecting diagnostic file for ${host} failed`,
        severity: 'error'
    })
});

export default function(action$) {
    return action$
        .map(action => {
            const notif = actionToNotification[action.type];
            if (notif) {
                const { message, severity } = notif(action.payload);
                return showNotification(message, severity);
            }
        });
}
