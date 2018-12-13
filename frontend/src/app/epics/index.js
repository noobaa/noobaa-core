/* Copyright (C) 2016 NooBaa */

import { from } from 'rxjs';
import { mergeAll } from 'rxjs/operators';
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
import regenerateAccountCredentials from './regenerate-account-credentials';
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
import createBucket from './create-bucket';
import updateBucketQuotaPolicy from './update-bucket-quota-policy';
import updateBucketSpilloverPolicy from './update-bucket-spillover-policy';
import updateBucketPlacementPolicy from './update-bucket-placement-policy';
import updateBucketResiliencyPolicy from './update-bucket-resiliency-policy';
import updateBucketVersioningPolicy from './update-bucket-versioning-policy';
import deleteBucket from './delete-bucket';
import fetchCloudTargets from './fetch-cloud-targets';
import createNamespaceResource from './create-namespace-resource';
import deleteNamespaceResource from './delete-namespace-resource';
import createNamespaceBucket from './create-namespace-bucket';
import updateNamespaceBucketPlacement from './update-namespace-bucket-placement';
import deleteNamespaceBucket from './delete-namespace-bucket';
import retrustHost from './retrust-host';
import fetchObjects from './fetch-objects';
import fetchObject from './fetch-object';
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
import addBucketTrigger from './add-bucket-trigger';
import updateBucketTrigger from './update-bucket-trigger';
import removeBucketTrigger from './remove-bucket-trigger';
import closeModalsOnLocationChange from './close-modals-on-location-change';
import attachServerToCluster from './attach-server-to-cluster';
import createCloudResource from './create-cloud-resource';
import updateRemoteSyslog from './update-remote-syslog';
import createLambdaFunc from './create-lambda-func';
import enterMaintenanceMode from './enter-maintenance-mode';
import leaveMaintenanceMode from './leave-maintenance-mode';
import fetchCloudResourceObjects from './fetch-cloud-resource-objects';
import assignRegionToResource from './assign-region-to-resource';
import installVMTools from './install-vm-tools';
import fetchBucketUsageHistory from './fetch-bucket-usage-history';
import fetchAccountUsageHistory from './fetch-account-usage-history';
import fetchObjectsDistribution from './fetch-objects-distribution';
import fetchCloudUsageStats from './fetch-cloud-usage-stats';
import updateP2PSettings from './update-p2p-settings';

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
    upgradeSystem,
    updateRemoteSyslog,
    enterMaintenanceMode,
    leaveMaintenanceMode,
    installVMTools,
    updateP2PSettings
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
    regenerateAccountCredentials,
    addExternalConnection,
    tryDeleteAccount,
    signOutDeletedUser,
    deleteExternalConnection
];

const bucketRelatedEpics = [
    createBucket,
    updateBucketQuotaPolicy,
    updateBucketSpilloverPolicy,
    updateBucketPlacementPolicy,
    updateBucketResiliencyPolicy,
    updateBucketVersioningPolicy,
    deleteBucket,
    createNamespaceBucket,
    updateNamespaceBucketPlacement,
    deleteNamespaceBucket,
    updateBucketS3Access,
    addBucketTrigger,
    updateBucketTrigger,
    removeBucketTrigger
];

const objectRelatedEpics = [
    uploadObjects,
    fetchObjects,
    fetchObject,
    deleteObject,
    fetchObjectParts
];

const resourceRelatedEpics = [
    createHostsPool,
    deleteResource,
    assignHostsToPool,
    createCloudResource,
    fetchCloudResourceObjects,
    assignRegionToResource
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

const lambdaRelatedEpics = [
    createLambdaFunc
];

const analyticsRelatedEpics = [
    fetchBucketUsageHistory,
    fetchAccountUsageHistory,
    fetchObjectsDistribution,
    fetchCloudUsageStats
];

// A utility that combine multiple epics into one epic.
function _combineEpics(epics) {
    return (action$, injected) => {
        const observables = epics.map(epic => epic(action$, injected));
        return from(observables).pipe(mergeAll());
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
    ...namespaceRelatedEpics,
    ...lambdaRelatedEpics,
    ...analyticsRelatedEpics
]);
