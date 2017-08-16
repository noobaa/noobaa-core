/* Copyright (C) 2016 NooBaa */

import Rx from 'rx';
import notify from './notify';
import createSystem from './create-system';
import restoreSession from './restore-session';
import handleLocationRequests from './handle-location-requests';
import signIn from './sign-in';
import fetchSystemInfo from './fetch-system-info';
import createAccount from './create-account';
import triggerFetchSystemInfo from './trigger-fetch-system-info';
import lockCreateAccountModal from './lock-create-account-modal';
import showAccountCreatedMessage from './show-account-created-message';
import closeCreateAccountOnFaliure from './close-create-account-on-faliure';
import updateAccountS3Access from './update-account-s3-access';
import fetchAlerts from './fetch-alerts';
import updateAlerts from './update-alerts';
import fetchUnreadAlertsCount from './fetch-unread-alerts-count';
import updateBucketQuota from './update-bucket-quota';
import fetchNodeInstallationCommands from './fetch-node-installation-commands';
import uploadObjects from './upload-objects';
import setAccountIpRestrictions from './set-account-ip-restrictions';
import updateInstallNodesFormCommandsField from './update-install-nodes-form-commands-field';
import changeAccountPassword from './change-account-password';
import addExternalConnection from './add-external-connection';
import deleteResource from './delete-resource';
import createHostsPool from './create-hosts-pool';
import assignHostsToPool from './assign-hosts-to-pool';
import fetchHosts from './fetch-hosts';
import collectHostDiagnostics from './collect-host-diagnostics';
import setHostDebugMode from './set-host-debug-mode';
import toggleHostServices from './toggle-host-services';
import toggleHostNodes from './toggle-host-nodes';
import downloadFile from './download-file';


const generalEpics = [
    handleLocationRequests,
    notify,
    downloadFile
];

const sessionRelatedEpics = [
    restoreSession,
    signIn
];

const systemRelatedEpics = [
    createSystem,
    fetchSystemInfo,
    triggerFetchSystemInfo,
    fetchNodeInstallationCommands,
    updateInstallNodesFormCommandsField
];

const alertsRelatedEpics = [
    fetchAlerts,
    updateAlerts,
    fetchUnreadAlertsCount
];

const accountRelatedEpics = [
    createAccount,
    lockCreateAccountModal,
    showAccountCreatedMessage,
    closeCreateAccountOnFaliure,
    updateAccountS3Access,
    setAccountIpRestrictions,
    changeAccountPassword,
    addExternalConnection
];

const bucketRelatedEpics = [
    updateBucketQuota
];

const objectRelatedEpics = [
    uploadObjects
];

const resourceRelatedEpics = [
    createHostsPool,
    deleteResource,
    assignHostsToPool
];

const hostRelatedEpics = [
    fetchHosts,
    collectHostDiagnostics,
    setHostDebugMode,
    toggleHostServices,
    toggleHostNodes
];

// A utility that combine multiple epics into one epic.
function _combineEpics(epics) {
    return (action$, injected) => {
        return Rx.Observable
            .fromArray(epics.map(epic => epic(action$, injected)))
            .mergeAll();
    };
}

/// Create the root epic by combining all epics into one.
export default _combineEpics([
    ...generalEpics,
    ...sessionRelatedEpics,
    ...systemRelatedEpics,
    ...alertsRelatedEpics,
    ...accountRelatedEpics,
    ...bucketRelatedEpics,
    ...objectRelatedEpics,
    ...resourceRelatedEpics,
    ...hostRelatedEpics
]);
