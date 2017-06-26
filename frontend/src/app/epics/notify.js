import { deepFreeze } from 'utils/core-utils';
import { showNotification } from 'action-creators';
import {
    FAIL_CREATE_ACCOUNT,
    COMPLETE_UPDATE_ACCOUNT_S3_ACCESS,
    FAIL_UPDATE_ACCOUNT_S3_ACCESS,
    FAIL_UPDATE_BUCKET_QUOTA,
    COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS,
    FAIL_SET_ACCOUNT_IP_RESTRICTIONS
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

    [FAIL_UPDATE_BUCKET_QUOTA]: ({ bucket }) => ({
        message: `Updating quota for ${bucket} failed`,
        severity: 'error'
    }),

    [COMPLETE_SET_ACCOUNT_IP_RESTRICTIONS]: ({ accountName }) => ({
        message: `IP restrictions for ${accountName} set successfully`,
        severity: 'error'
    }),

    [FAIL_SET_ACCOUNT_IP_RESTRICTIONS]: ({ accountName }) => ({
        message: `Setting IP restrictions for ${accountName} failed`,
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
        })
        .filter(Boolean);
}
