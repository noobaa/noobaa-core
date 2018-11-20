/* Copyright (C) 2016 NooBaa */

import {
    OPEN_MODAL,
    UPDATE_MODAL,
    REPLACE_MODAL,
    LOCK_MODAL,
    CLOSE_MODAL
} from 'action-types';

export function updateModal(options) {
    return {
        type: UPDATE_MODAL,
        payload: options
    };
}

export function lockModal() {
    return { type: LOCK_MODAL };
}

export function closeModal(count = 1) {
    return {
        type: CLOSE_MODAL,
        payload: { count }
    };
}

export function replaceWithInstallNodesModal() {
    return {
        type: REPLACE_MODAL,
        payload: {
            component: 'install-nodes-modal',
            options: {
                title: 'Install Nodes',
                size: 'medium'
            }
        }
    };
}

export function openInstallNodesToPoolModal(targetPool) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'install-nodes-to-pool-modal',
                params: { targetPool }
            },
            options: {
                title: 'Install Nodes to Pool',
                size: 'medium'
            }
        }
    };
}

export function openAddCloudResourceModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'add-cloud-resource-modal',
            options: {
                title: 'Add Cloud Resource',
                size: 'medium'
            }
        }
    };
}

export function replaceWithAddCloudResourceModal() {
    return {
        type: REPLACE_MODAL,
        payload: {
            component: 'add-cloud-resource-modal',
            options: {
                title: 'Add Cloud Resource',
                size: 'medium'
            }
        }
    };
}

export function openAddCloudConnectionModal(allowedServices) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'add-cloud-connection-modal',
                params: { allowedServices }
            },
            options: {
                title: 'Add Cloud Connection',
                size: 'medium'
            }
        }
    };
}

export function openS3AccessDetailsModal(endpoint, accessKey, secretKey) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 's3-access-details-modal',
                params: { endpoint, accessKey, secretKey }
            },
            options: {
                title: 'Connection Details',
                size: 'xsmall'
            }
        }
    };
}

export function openBucketS3AccessModal(bucketName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-bucket-s3-access-modal',
                params: { bucketName }
            },
            options: {
                title: 'Edit Bucket S3 Access'
            }
        }
    };
}

export function openAddTierModal(bucketName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'add-tier-modal',
                params: { bucketName }
            },
            options: {
                title: 'Add a New Tier',
                size: 'xlarge'
            }
        }
    };
}

export function openEditTierDataPlacementModal(bucketName, tierName, tierDisplayName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-tier-data-placement-modal',
                params: { bucketName, tierName }
            },
            options: {
                title: `Edit ${tierDisplayName} Data Placement`,
                size: 'xlarge'
            }
        }
    };
}

export function openEditBucketDataResiliencyModal(bucketName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-bucket-data-resiliency-modal',
                params: { bucketName }
            },
            options: {
                title: 'Edit Data Resiliency',
                size: 'large'
            }
        }
    };
}

export function openRiskyBucketDataResiliencyWarningModal(action) {
    return {
        type: OPEN_MODAL,
        payload:{
            component: {
                name: 'risky-bucket-data-resiliency-warning-modal',
                params: { action }
            },
            options: {
                title: 'Risky Data Resiliency Policy',
                severity: 'warning',
                size: 'xsmall'
            }
        }
    };
}

export function openEmptyDataPlacementWarningModal(bucketName, tierName, action) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'empty-data-placement-warning-modal',
                params: { bucketName, tierName, action }
            },
            options: {
                title: 'Empty data placement policy',
                size: 'xsmall',
                severity: 'warning'
            }
        }
    };
}

export function openKeepUsingInternalStorageModal(action) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'keep-using-internal-storage-modal',
                params: { action }
            },
            options: {
                title: 'Internal Storage Usage',
                size: 'xsmall',
                severity: 'warning',
                closeButton: 'hidden',
                backdropClose: false
            }
        }
    };
}

export function openFileUploadsModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'file-uploads-modal',
            options: {
                title: 'File Uploads',
                size: 'large'
            }
        }
    };
}

export function openDeleteCurrentAccountWarningModal(email) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'delete-current-account-warning-modal',
                params: { email }
            },
            options: {
                title: 'Deleting Current Account',
                severity: 'warning',
                size: 'xsmall'
            }
        }
    };
}

export function openStartMaintenanceModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'start-maintenance-modal',
            options: {
                title: 'Maintenance Mode',
                size: 'xsmall'
            }
        }
    };
}

export function openObjectPreviewModal(objectUri) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'object-preview-modal',
                params: { objectUri }
            },
            options: {
                size: 'large'
            }
        }
    };
}

export function openTestNodeModal(nodeRpcAddress) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'test-node-modal',
                params: { nodeRpcAddress }
            },
            options: {
                size: 'xlarge',
                title: 'Node\'s connectivity test',
                backdropClose: false,
                closeButton: 'hidden'
            }
        }
    };
}

export function openEditServerDNSSettingsModal(serverSecret) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-server-dns-settings-modal',
                params: { serverSecret }
            },
            options: {
                title: 'Edit Server DNS Settings',
                size: 'medium'
            }
        }
    };
}

export function openEditServerTimeSettingsModal(serverSecret) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-server-time-settings-modal',
                params: { serverSecret }
            },
            options: {
                title: 'Edit Server Time Settings'
            }
        }
    };
}

export function openEditAccountS3AccessModal(accountName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-account-s3-access-modal',
                params: { accountName }
            },
            options: {
                title: 'Edit Account S3 Access',
                size: 'medium'
            }
        }
    };
}

export function openEditServerDetailsModal(serverSecret) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-server-details-modal',
                params: { serverSecret }
            },
            options: {
                size: 'xsmall',
                title: 'Edit Server Details'
            }
        }
    };
}

export function openAssignHostsModal(targetPool) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'assign-hosts-modal',
                params: { targetPool }
            },
            options: {
                size: 'auto-height',
                title: 'Assign Nodes'
            }
        }
    };
}

export function openUpdateSystemNameModal(name) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'update-system-name-modal',
                params: { name }
            },
            options: {
                size: 'xsmall',
                title: 'Updating System Name'
            }
        }
    };
}

export function openUnableToActivateModal(reason) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'unable-to-activate-modal',
                params: { reason }
            },
            options: {
                size: 'small',
                title: 'NooBaa\'s Activation Servers Unreachable'
            }
        }
    };
}

export function openCreateAccountModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'create-account-modal',
            options: {
                size: 'medium',
                title: 'Create Account'
            }
        }
    };
}

export function openEditBucketQuotaModal(bucketName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-bucket-quota-modal',
                params: { bucketName }
            },
            options: {
                size: 'small',
                title: 'Edit Quota'
            }
        }

    };
}

export function replaceWithAccountCreatedModal(accountName, password) {
    return {
        type: REPLACE_MODAL,
        payload: {
            component: {
                name:'account-created-modal',
                params: { accountName, password }
            },
            options: {
                title: 'Account Created Successfully',
                severity: 'success',
                size: 'small'
            }
        }
    };
}

export function openSetAccountIpRestrictionsModal(accountName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'set-account-ip-restrictions-modal',
                params: { accountName }
            },
            options: {
                title: 'Set IP Restrictions'
            }
        }
    };
}

export function openCreatePoolModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'create-pool-modal',
            options: {
                size: 'small',
                title: 'Create Pool Resource'
            }
        }
    };
}

export function openEditHostStorageDrivesModal(host) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-host-storage-drives-modal',
                params: { host }
            },
            options:{
                size: 'medium',
                title: 'Edit Storage Drives'
            }
        }
    };
}

export function openDisableHostEndpointWarningModal(host, isLastService) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'disable-host-endpoint-warning-modal',
                params: { host, isLastService }
            },
            options: {
                size: 'xsmall',
                severity: 'warning',
                title: 'Disable Node S3 Endpoint Service'
            }
        }
    };
}

export function openConnectAppModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'connect-app-modal',
            options:{
                size: 'small',
                title: 'Connect an Application'
            }
        }
    };
}

export function openDisableHostStorageWarningModal(host, isLastService) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'disable-host-storage-warning-modal',
                params: { host, isLastService }
            },
            options: {
                size: 'xsmall',
                severity: 'warning',
                title: 'Disable Node Storage Service'
            }
        }
    };
}

export function openDisableHostLastServiceWarningModal(host, service) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'disable-host-last-service-warning-modal',
                params: { host, service }
            },
            options: {
                size: 'xsmall',
                severity: 'warning',
                title: 'Deactivate Node Last Service'
            }
        }
    };
}
export function openCreateNamespaceResourceModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'create-namespace-resource-modal',
            options: {
                title: 'Create Namespace Resource',
                size: 'medium'
            }
        }
    };
}

export function openCreateNamespaceBucketModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'create-namespace-bucket-modal',
            options: {
                title: 'Create Namespace Bucket',
                size: 'medium'
            }
        }
    };
}

export function openEditNamespaceBucketDataPlacementModal(bucket) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-namespace-bucket-data-placement-modal',
                params: { bucket }
            },
            options: {
                title: 'Edit Bucket Data Placement Policy',
                size: 'medium'
            }
        }
    };
}

export function openSetNodeAsTrustedModal(host, untrustedReasons) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'set-node-as-trusted-modal',
                params: { host, untrustedReasons }
            },
            options: {
                title: 'Set Node as Trusted',
                size: 'small'
            }
        }
    };
}

export function openConfirmDeleteHostModal(host) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'confirm-delete-host-modal',
                params: { host }
            },
            options: {
                title: 'Delete Node',
                size: 'xsmall',
                severity: 'warning'
            }
        }
    };
}

export function openWelcomeModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'welcome-modal',
            options: {
                size: 'xsmall',
                severity: 'success',
                title: 'System Created Successfully',
                backdropClose: false,
                closeButton: 'hidden'
            }
        }
    };
}

export function openUpgradeSystemModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'upgrade-system-modal',
            options: {
                title: 'System Upgrade Preview',
                size: 'medium'
            }
        }
    };
}

export function openAttachServerModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'attach-server-modal',
            options: {
                title: 'Attach New Server',
                size: 'medium'
            }
        }
    };
}

export function replaceWithPreUpgradeSystemFailedModal() {
    return {
        type: REPLACE_MODAL,
        payload: {
            component: 'pre-upgrade-system-failed-modal',
            options: {
                severity: 'error',
                title: 'System Upgrade Failed',
                size: 'small'
            }
        }
    };
}

export function replaceWithUpgradeSystemFailedModal() {
    return {
        type: REPLACE_MODAL,
        payload: {
            component: 'upgrade-system-failed-modal',
            options: {
                severity: 'error',
                title: 'System Upgrade Failed',
                size: 'xsmall'
            }
        }
    };
}

export function openFinalizeUpgradeModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'finalize-upgrade-modal',
            options: {
                size: 'xsmall',
                backdropClose: false
            }
        }
    };
}

export function replaceWithAfterUpgradeModal(version, user, upgradeInitiator, redirectUrl) {
    const title = user === upgradeInitiator ?
        'Upgrade was Successful' :
        'System was Upgraded by Admin';

    return {
        type: REPLACE_MODAL,
        payload: {
            component: {
                name: 'after-upgrade-modal',
                params: { version, user, upgradeInitiator, redirectUrl }
            },
            options: {
                title: title,
                size: 'xsmall',
                severity: 'success',
                backdropClose: false,
                closeButton: 'hidden'
            }
        }
    };
}

export function replaceWithAfterUpgradeFailureModal(redirectUrl) {
    return {
        type: REPLACE_MODAL,
        payload: {
            component: {
                name: 'after-upgrade-failure-modal',
                params: { redirectUrl }
            },
            options: {
                title: 'System Upgrade Failed',
                size: 'xsmall',
                severity: 'error',
                backdropClose: false,
                closeButton: 'hidden'
            }
        }
    };
}

export function openChangeClusterConnectivityIpModal(secret) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'change-cluster-connectivity-ip-modal',
                params: { secret }
            },
            options: {
                title: 'Change Cluster Connectivity IP',
                size: 'small'
            }
        }
    };
}

export function openManagementConsoleErrorModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'management-console-error-modal',
            options: {
                title: 'Management Console Error',
                size: 'xsmall',
                severity: 'error',
                backdropClose: false,
                closeButton: 'hidden'
            }
        }
    };
}

export function openAddBucketTriggerModal(bucketName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'add-bucket-trigger-modal',
                params: { bucketName }
            },
            options: {
                size: 'medium',
                title: 'Add Trigger'
            }
        }
    };
}

export function openEditBucketTriggerModal(bucketName, triggerId) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-bucket-trigger-modal',
                params: { bucketName, triggerId }
            },
            options: {
                size: 'medium',
                title: 'Edit Trigger'
            }
        }
    };
}

export function openCreateFuncModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'create-func-modal',
            options: {
                title: 'Create Function',
                size: 'medium'
            }
        }
    };
}

export function openCreateBucketModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'create-bucket-modal',
            options: {
                title: 'Create Bucket',
                size: 'small'
            }
        }
    };
}


export function openRegenerateAccountCredentialsModal(accountName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'regenerate-account-credentials-modal',
                params: { accountName }
            },
            options: {
                title: 'Regenerate Account Credentials',
                size: 'xsmall'
            }
        }
    };
}

export function openAssignRegionModal(resourceType, resourceName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'assign-region-modal',
                params: { resourceType, resourceName }
            },
            options: {
                title: 'Assign Region',
                size: 'xsmall'
            }
        }
    };
}


export function openChangePasswordModal(accountName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'change-password-modal',
                params: { accountName }
            },
            options: {
                title: 'Change My Account Password',
                size: 'small'
            }
        }
    };
}

export function openResetPasswordModal(accountName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'reset-password-modal',
                params: { accountName }
            },
            options: {
                title: 'Reset Account Password',
                size: 'xsmall'
            }
        }
    };
}

export function openPasswordResetCompletedModal(accountName, password) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'password-reset-completed-modal',
                params: { accountName, password }
            },
            options: {
                title: 'Password Reset Successful',
                size: 'small',
                severity: 'success'
            }
        }
    };
}

export function openPasswordResetFailedModal(accountName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'password-reset-failed-modal',
                params: { accountName }
            },
            options: {
                title: 'Password Reset Failed',
                size: 'xsmall',
                severity: 'error'
            }
        }
    };
}

export function openEditFuncConfigModal(funcName, funcVersion) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-func-config-modal',
                params: { funcName, funcVersion }
            },
            options: {
                title: 'Function Configuration',
                size: 'medium'
            }
        }
    };
}

export function openInvokeFuncModal(funcName, funcVersion) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'invoke-func-modal',
                params: { funcName, funcVersion }
            },
            options: {
                title: 'Set Event and Invoke',
                size: 'medium'
            }
        }
    };
}

export function openBucketPlacementSummaryModal(bucketName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'bucket-placement-summary-modal',
                params: { bucketName }
            },
            options: {
                title: 'Bucket Tiering Structure',
                size: 'xlarge'
            }
        }
    };
}

export function openEditFuncCodeModal(funcName, funcVersion) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-func-code-modal',
                params: { funcName, funcVersion }
            },
            options: {
                title: 'Edit Function Code',
                size: 'medium'
            }
        }
    };
}

export function openAddResourcesModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'add-resources-modal',
            options: {
                title: 'Add Resources'
            }
        }
    };
}
/** INJECT:actionCreator **/
