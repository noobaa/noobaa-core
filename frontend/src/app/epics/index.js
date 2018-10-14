/* Copyright (C) 2016 NooBaa */

import { from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import notify from './notify';
import createSystem from './create-system';
import restoreSession from './restore-session';
import handleLocationRequests from './handle-location-requests';
import signIn from './sign-in';
import fetchSystemInfo from './fetch-system-info';
import createAccount from './create-account';
import refresh from './refresh';
import reactToCreateAccountResult from './react-to-create-account-result';
import reactToResetAccountPasswordResult from './react-to-reset-account-password-result';
import updateAccountS3Access from './update-account-s3-access';
import fetchAlerts from './fetch-alerts';
import updateAlerts from './update-alerts';
import fetchUnreadAlertsCount from './fetch-unread-alerts-count';
import fetchNodeInstallationCommands from './fetch-node-installation-commands';
import uploadObjects from './upload-objects';
import setAccountIpRestrictions from './set-account-ip-restrictions';
import updateInstallNodesFormCommandsField from './update-install-nodes-form-commands-field';
import changeAccountPassword from './change-account-password';
import resetAccountPassword from './reset-account-password';
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
import updateLambdaFuncConfig from './update-lambda-func-config';
import updateLambdaFuncCode from './update-lambda-func-code';
import deleteLambdaFunc from './delete-lambda-func';
import loadLambdaFuncCode from './load-lambda-func-code';
import invokeLambdaFunc from './invoke-lambda-func';
import enterMaintenanceMode from './enter-maintenance-mode';
import leaveMaintenanceMode from './leave-maintenance-mode';
import fetchCloudResourceObjects from './fetch-cloud-resource-objects';
import assignRegionToResource from './assign-region-to-resource';
import installVMTools from './install-vm-tools';
import fetchBucketUsageHistory from './fetch-bucket-usage-history';
import fetchAccountUsageHistory from './fetch-account-usage-history';
import fetchLambdaFuncUsageHistory from './fetch-lambda-func-usage-history';
import fetchObjectsDistribution from './fetch-objects-distribution';
import fetchCloudUsageStats from './fetch-cloud-usage-stats';
import updateP2PSettings from './update-p2p-settings';
import resendActivationCode from './resend-activation-code';
import updateProxyServerSettings from './update-proxy-server-settings';
import setSystemDebugMode from './set-system-debug-mode';
import collectSystemDiagnostics from './collect-system-diagnostics';
import scheduleDebugModeRefresh from './schedule-debug-mode-refresh';
import scheduleMaintenanceModeRefresh from './schedule-maintenance-mode-refresh';
import scheduleAutoRefresh from './schedule-auto-refresh';

const epics = [
    // General epics
    handleLocationRequests,
    notify,
    downloadFile,
    fetchCloudTargets,
    reloadAfterSystemUpgrade,
    closeModalsOnLocationChange,
    scheduleAutoRefresh,

    // Session related epics
    restoreSession,
    signIn,

    // System related epics
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
    updateP2PSettings,
    resendActivationCode,
    updateProxyServerSettings,
    setSystemDebugMode,
    collectSystemDiagnostics,
    scheduleDebugModeRefresh,
    scheduleMaintenanceModeRefresh,

    // Topology related epics
    updateServerAddress,
    attachServerToCluster,

    // Alerts related epics
    fetchAlerts,
    updateAlerts,
    fetchUnreadAlertsCount,

    // Account related epics
    createAccount,
    reactToCreateAccountResult,
    reactToResetAccountPasswordResult,
    updateAccountS3Access,
    setAccountIpRestrictions,
    changeAccountPassword,
    resetAccountPassword,
    regenerateAccountCredentials,
    addExternalConnection,
    tryDeleteAccount,
    signOutDeletedUser,
    deleteExternalConnection,

    // Bucket related epics
    createBucket,
    updateBucketQuotaPolicy,
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
    removeBucketTrigger,

    // Object related epics
    uploadObjects,
    fetchObjects,
    fetchObject,
    deleteObject,
    fetchObjectParts,

    // Resource related epics
    createHostsPool,
    deleteResource,
    assignHostsToPool,
    createCloudResource,
    fetchCloudResourceObjects,
    assignRegionToResource,

    // Host related epics
    fetchHosts,
    fetchHostObjects,
    collectHostDiagnostics,
    setHostDebugMode,
    toggleHostServices,
    toggleHostNodes,
    retrustHost,
    deleteHost,

    // Namespace related epics
    createNamespaceResource,
    deleteNamespaceResource,

    // Lambda related epics
    createLambdaFunc,
    deleteLambdaFunc,
    updateLambdaFuncConfig,
    updateLambdaFuncCode,
    loadLambdaFuncCode,
    invokeLambdaFunc,

    // Analytics related epics
    fetchBucketUsageHistory,
    fetchAccountUsageHistory,
    fetchLambdaFuncUsageHistory,
    fetchObjectsDistribution,
    fetchCloudUsageStats
];


/// Create the root epic by merging all epics into one.
export default function (action$, injected) {
    return from(epics).pipe(
        mergeMap(epic => epic(action$, injected))
    );
}

