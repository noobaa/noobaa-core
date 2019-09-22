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
import fetchAuditLog from './fetch-audit-log';
import exportAuditLog from './export-audit-log';
import updateAlerts from './update-alerts';
import fetchUnreadAlertsCount from './fetch-unread-alerts-count';
import fetchAlerts from './fetch-alerts';
import fetchNodeInstallationCommands from './fetch-node-installation-commands';
import uploadObjects from './upload-objects';
import setAccountIpRestrictions from './set-account-ip-restrictions';
import updateInstallNodesFormCommandsField from './update-install-nodes-form-commands-field';
import changeAccountPassword from './change-account-password';
import resetAccountPassword from './reset-account-password';
import regenerateAccountCredentials from './regenerate-account-credentials';
import addExternalConnection from './add-external-connection';
import updateExternalConnection from './update-external-connection';
import deleteExternalConnection from './delete-external-connection';
import deleteResource from './delete-resource';
import createHostsPool from './create-hosts-pool';
import scaleHostsPool from './scale-hosts-pool';
import fetchHosts from './fetch-hosts';
import collectHostDiagnostics from './collect-host-diagnostics';
import setHostDebugMode from './set-host-debug-mode';
import downloadFile from './download-file';
import fetchHostObjects from './fetch-host-objects';
import tryDeleteAccount from './try-delete-account';
import signOutDeletedUser from './sign-out-deleted-user';
import createBucket from './create-bucket';
import updateBucketQuotaPolicy from './update-bucket-quota-policy';
import updateBucketResiliencyPolicy from './update-bucket-resiliency-policy';
import updateBucketVersioningPolicy from './update-bucket-versioning-policy';
import addBucketTier from './add-bucket-tier';
import deleteBucket from './delete-bucket';
import updateTierPlacementPolicy from './update-tier-placement-policy';
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
import fetchVersionReleaseNotes from './fetch-version-release-notes';
import updateServerAddress from './update-server-address';
import updateBucketS3Access from './update-bucket-s3-access';
import addBucketTrigger from './add-bucket-trigger';
import updateBucketTrigger from './update-bucket-trigger';
import removeBucketTrigger from './remove-bucket-trigger';
import closeModalsOnLocationChange from './close-modals-on-location-change';
import attachServerToCluster from './attach-server-to-cluster';
import createCloudResource from './create-cloud-resource';
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
import fetchBucketUsageHistory from './fetch-bucket-usage-history';
import fetchAccountUsageHistory from './fetch-account-usage-history';
import fetchLambdaFuncUsageHistory from './fetch-lambda-func-usage-history';
import fetchObjectsDistribution from './fetch-objects-distribution';
import fetchCloudUsageStats from './fetch-cloud-usage-stats';
import updateP2PSettings from './update-p2p-settings';
import resendActivationCode from './resend-activation-code';
import setSystemDebugMode from './set-system-debug-mode';
import collectSystemDiagnostics from './collect-system-diagnostics';
import scheduleDebugModeRefresh from './schedule-debug-mode-refresh';
import scheduleMaintenanceModeRefresh from './schedule-maintenance-mode-refresh';
import scheduleAutoRefresh from './schedule-auto-refresh';
import updateAccountPreferedTheme from './update-account-prefered-theme';
import updateServerDetails from './update-server-details';
import redirectAfterSignOut from './redirect-after-sign-out';
import uploadSSLCertificate from './upload-ssl-certificate';

const epics = [
    // General epics
    handleLocationRequests,
    notify,
    downloadFile,
    fetchCloudTargets,
    closeModalsOnLocationChange,
    scheduleAutoRefresh,

    // Session related epics
    restoreSession,
    signIn,
    redirectAfterSignOut,

    // System related epics
    createSystem,
    fetchSystemInfo,
    refresh,
    fetchNodeInstallationCommands,
    updateInstallNodesFormCommandsField,
    fetchSystemStorageHistory,
    fetchVersionReleaseNotes,
    enterMaintenanceMode,
    leaveMaintenanceMode,
    updateP2PSettings,
    resendActivationCode,
    setSystemDebugMode,
    collectSystemDiagnostics,
    scheduleDebugModeRefresh,
    scheduleMaintenanceModeRefresh,
    uploadSSLCertificate,

    // Topology related epics
    updateServerAddress,
    attachServerToCluster,
    updateServerDetails,

    // Alerts related epics
    fetchAlerts,
    updateAlerts,
    fetchUnreadAlertsCount,

    // Audit log related epics
    fetchAuditLog,
    exportAuditLog,

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
    updateExternalConnection,
    tryDeleteAccount,
    signOutDeletedUser,
    deleteExternalConnection,
    updateAccountPreferedTheme,

    // Bucket related epics
    createBucket,
    updateBucketQuotaPolicy,
    updateBucketResiliencyPolicy,
    updateBucketVersioningPolicy,
    addBucketTier,
    deleteBucket,
    updateTierPlacementPolicy,
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
    scaleHostsPool,
    deleteResource,
    createCloudResource,
    fetchCloudResourceObjects,
    assignRegionToResource,

    // Host related epics
    fetchHosts,
    fetchHostObjects,
    collectHostDiagnostics,
    setHostDebugMode,
    retrustHost,

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

