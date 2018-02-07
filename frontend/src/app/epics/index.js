/* Copyright (C) 2016 NooBaa */

import Rx from 'rx';
import notify from './notify';
import createSystem from './create-system';
import restoreSession from './restore-session';
import handleLocationRequests from './handle-location-requests';
import signIn from './sign-in';
import fetchSystemInfo from './fetch-system-info';
import createAccount from './create-account';
import refresh from './refresh';
import showAccountCreatedMessage from './show-account-created-message';
import closeCreateAccountOnFaliure from './close-create-account-on-faliure';
import updateAccountS3Access from './update-account-s3-access';
import fetchAlerts from './fetch-alerts';
import updateAlerts from './update-alerts';
import fetchUnreadAlertsCount from './fetch-unread-alerts-count';
import fetchNodeInstallationCommands from './fetch-node-installation-commands';
import uploadObjects from './upload-objects';
import setAccountIpRestrictions from './set-account-ip-restrictions';
import updateInstallNodesFormCommandsField from './update-install-nodes-form-commands-field';
import changeAccountPassword from './change-account-password';
import addExternalConnection from './add-external-connection';
import deleteExternalConnection from './delete-external-connection';
import deleteResource from './delete-resource';
import createHostsPool from './create-hosts-pool';
import assignHostsToPool from './assign-hosts-to-pool';
import fetchHosts from './fetch-hosts';
import collectHostDiagnostics from './collect-host-diagnostics';
import setHostDebugMode from './set-host-debug-mode';
import toggleHostServices from './toggle-host-services';
import toggleHostNodes from './toggle-host-nodes';
import downloadFile from './download-file';
import fetchHostObjects from './fetch-host-objects';
import tryDeleteAccount from './try-delete-account';
import signOutDeletedUser from './sign-out-deleted-user';
import updateBucketQuota from './update-bucket-quota';
import updateBucketSpillover from './update-bucket-spillover';
import updateBucketPlacementPolicy from './update-bucket-placement-policy';
import updateBucketResiliencyPolicy from './update-bucket-resiliency-policy';
import deleteBucket from './delete-bucket';
import fetchCloudTargets from './fetch-cloud-targets';
import createNamespaceResource from './create-namespace-resource';
import deleteNamespaceResource from './delete-namespace-resource';
import createNamespaceBucket from './create-namespace-bucket';
import updateNamespaceBucketPlacement from './update-namespace-bucket-placement';
import deleteNamespaceBucket from './delete-namespace-bucket';
import retrustHost from './retrust-host';
import fetchObjects from './fetch-objects';
import deleteObject from './delete-object';
import fetchObjectParts from './fetch-object-parts';
import fetchSystemStorageHistory from './fetch-system-storage-history';
import deleteHost from './delete-host';
import uploadUpgradePackage from './upload-upgrade-package';
import runUpgradePackageTests from './run-upgrade-package-tests';
import fetchVersionReleaseNotes from './fetch-version-release-notes';
import invokeUpgradeSystem from './invoke-upgrade-system';
import upgradeSystem from './upgrade-system';
import reloadAfterSystemUpgrade from './reload-after-system-upgrade';
import updateServerAddress from './update-server-address';
import updateBucketS3Access from './update-bucket-s3-access';
import deleteCloudSyncPolicy from './delete-cloud-sync-policy';
import toggleCloudSyncPolicy from './toggle-cloud-sync-policy';
import addBucketTrigger from './add-bucket-trigger';
import updateBucketTrigger from './update-bucket-trigger';
import removeBucketTrigger from './remove-bucket-trigger';
import closeModalsOnLocationChange from './close-modals-on-location-change';
import attachServerToCluster from './attach-server-to-cluster';

const generalEpics = [
    handleLocationRequests,
    notify,
    downloadFile,
    fetchCloudTargets,
    reloadAfterSystemUpgrade,
    closeModalsOnLocationChange
];

const sessionRelatedEpics = [
    restoreSession,
    signIn
];

const systemRelatedEpics = [
    createSystem,
    fetchSystemInfo,
    refresh,
    fetchNodeInstallationCommands,
    updateInstallNodesFormCommandsField,
    fetchSystemStorageHistory,
    uploadUpgradePackage,
    runUpgradePackageTests,
    fetchVersionReleaseNotes,
    invokeUpgradeSystem,
    upgradeSystem
];

const topologyRelatedEpics = [
    updateServerAddress,
    attachServerToCluster
];

const alertsRelatedEpics = [
    fetchAlerts,
    updateAlerts,
    fetchUnreadAlertsCount
];

const accountRelatedEpics = [
    createAccount,
    showAccountCreatedMessage,
    closeCreateAccountOnFaliure,
    updateAccountS3Access,
    setAccountIpRestrictions,
    changeAccountPassword,
    addExternalConnection,
    tryDeleteAccount,
    signOutDeletedUser,
    deleteExternalConnection
];

const bucketRelatedEpics = [
    updateBucketQuota,
    updateBucketSpillover,
    updateBucketPlacementPolicy,
    updateBucketResiliencyPolicy,
    deleteBucket,
    createNamespaceBucket,
    updateNamespaceBucketPlacement,
    deleteNamespaceBucket,
    updateBucketS3Access,
    deleteCloudSyncPolicy,
    toggleCloudSyncPolicy,
    addBucketTrigger,
    updateBucketTrigger,
    removeBucketTrigger
];

const objectRelatedEpics = [
    uploadObjects,
    fetchObjects,
    deleteObject,
    fetchObjectParts
];

const resourceRelatedEpics = [
    createHostsPool,
    deleteResource,
    assignHostsToPool
];

const hostRelatedEpics = [
    fetchHosts,
    fetchHostObjects,
    collectHostDiagnostics,
    setHostDebugMode,
    toggleHostServices,
    toggleHostNodes,
    retrustHost,
    deleteHost
];

const namespaceRelatedEpics = [
    createNamespaceResource,
    deleteNamespaceResource
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
    ...topologyRelatedEpics,
    ...alertsRelatedEpics,
    ...accountRelatedEpics,
    ...bucketRelatedEpics,
    ...objectRelatedEpics,
    ...resourceRelatedEpics,
    ...hostRelatedEpics,
    ...namespaceRelatedEpics
]);
