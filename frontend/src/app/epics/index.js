/* Copyright (C) 2016 NooBaa */

import Rx from 'rx';
import notifyEpic from './notify';
import createSystemEpic from './create-system';
import restoreSessionEpic from './restore-session';
import handleLocationRequests from './handle-location-requests';
import signInEpic from './sign-in';
import fetchSystemInfoEpic from './fetch-system-info';
import createAccountEpic from './create-account';
import triggerFetchSystemInfoEpic from './trigger-fetch-system-info';
import lockCreateAccountModalEpic from './lock-create-account-modal';
import showAccountCreatedMessageEpic from './show-account-created-message';
import closeCreateAccountOnFaliureEpic from './close-create-account-on-faliure';
import updateAccountS3AccessEpic from './update-account-s3-access';
import fetchAlertsEpic from './fetch-alerts';
import updateAlertsEpic from './update-alerts';
import fetchUnreadAlertsCountEpic from './fetch-unread-alerts-count';
import updateBucketQuotaEpic from './update-bucket-quota';
import fetchNodeInstallationCommandsEpic from './fetch-node-installation-commands';
import uploadObjectsEpic from './upload-objects';
import setAccountIpRestrictionsEpic from './set-account-ip-restrictions';
import updateInstallNodesFormCommandsFieldEpic from './update-install-nodes-form-commands-field';
import changeAccountPasswordEpic from './change-account-password';
import addExternalConnectionEpic from './add-external-connection';
import fetchResourceStorageHistoryEpic from './fetch-resource-storage-history';

// A utility that combine multiple epics into one epic.
function combineEpics(epics) {
    return (action$, injected) => {
        return Rx.Observable
            .fromArray(epics.map(epic => epic(action$, injected)))
            .mergeAll();
    };
}

export default combineEpics([
    notifyEpic,
    createSystemEpic,
    restoreSessionEpic,
    handleLocationRequests,
    signInEpic,
    fetchSystemInfoEpic,
    triggerFetchSystemInfoEpic,
    createAccountEpic,
    lockCreateAccountModalEpic,
    showAccountCreatedMessageEpic,
    closeCreateAccountOnFaliureEpic,
    updateAccountS3AccessEpic,
    fetchAlertsEpic,
    updateAlertsEpic,
    fetchUnreadAlertsCountEpic,
    updateBucketQuotaEpic,
    fetchNodeInstallationCommandsEpic,
    uploadObjectsEpic,
    setAccountIpRestrictionsEpic,
    updateInstallNodesFormCommandsFieldEpic,
    changeAccountPasswordEpic,
    addExternalConnectionEpic,
    fetchResourceStorageHistoryEpic
]);
