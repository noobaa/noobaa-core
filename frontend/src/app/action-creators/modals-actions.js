/* Copyright (C) 2016 NooBaa */

import {
    OPEN_MODAL,
    UPDATE_MODAL,
    CLOSE_MODAL
} from 'action-types';

export function updateModal(options) {
    return {
        type: UPDATE_MODAL,
        payload: options
    };
}

export function closeModal(count = 1) {
    return {
        type: CLOSE_MODAL,
        payload: { count }
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
                size: 'small'
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

export function openAccountCreatedModal(accountName, password) {
    return {
        type: OPEN_MODAL,
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

export function openConnectAppModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'connect-app-modal',
            options:{
                size: 'medium',
                title: 'Connect Application'
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

export function openAddBucketTriggerModal(bucketName, funcId = null) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'add-bucket-trigger-modal',
                params: { bucketName, funcId }
            },
            options: {
                size: 'medium',
                title: 'Add Trigger'
            }
        }
    };
}

export function openEditBucketTriggerModal(mode, triggerId) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-bucket-trigger-modal',
                params: { triggerId, mode }
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

export function openSessionExpiredModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'session-expired-modal',
            options: {
                title: 'Session Expired',
                size: 'xsmall',
                severity: 'info',
                closeButton: 'hidden',
                backdropClose: false
            }
        }
    };
}

export function openDeployK8sPoolModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'deploy-k8s-pool-modal',
                params: { }
            },
            options: {
                title: 'Deploy Kubernetes Pool',
                size: 'medium'
            }
        }
    };
}

export function openEditK8sPoolModal(poolName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-k8s-pool-modal',
                params: { poolName }
            },
            options: {
                title: 'Edit Pool Configuration',
                size: 'medium'
            }
        }
    };
}

export function openDeletePoolWithDataWarningModal(poolName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'delete-pool-with-data-warning-modal',
                params: { poolName }
            },
            options: {
                title: 'Delete Pool with Stored Data',
                severity: 'warning',
                size: 'small'
            }
        }
    };
}

export function openConfirmDangerousScalingModal(action) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'confirm-dangerous-scaling-modal',
                params: { action }
            },
            options: {
                title: 'Not Enough Storage Capacity',
                severity: 'warning',
                size: 'xsmall'
            }
        }
    };
}

export function openEditCloudConnectionModal(accountName, connectionName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-cloud-connection-modal',
                params: { accountName, connectionName }
            },
            options: {
                title: 'Edit Cloud Connection',
                size: 'medium'
            }
        }
    };
}

export function openCloudConnectionUpdateWarningModal(accountName, connectionName, updateAction) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'cloud-connection-update-warning-modal',
                params: { accountName, connectionName, updateAction }
            },
            options: {
                title: 'Connection Access Issue',
                size: 'small',
                severity: 'warning'
            }
        }
    };
}

export function openCompleteSSLCertificateInstallationModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'complete-ssl-certificate-installation-modal',
            options: {
                title: 'SSL Certificate Uploaded Successfully',
                size: 'xsmall',
                severity: 'success',
                closeButton: 'hidden',
                backdropClose: false
            }
        }
    };
}

export function openDeployRemoteEndpointGroupModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'deploy-remote-endpoint-group-modal',
            options: {
                title: 'Deploy Remote Endpoint Group',
                size: 'small'
            }
        }
    };
}

export function openEditEndpointGroupModal(groupName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-endpoint-group-modal',
                params: { groupName }
            },
            options: {
                title: 'Edit Endpoint Group ',
                size: 'small'
            }
        }
    };
}

export function openOAuthAccessDeniedModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'oauth-access-denied-modal',
                params: { }
            },
            options: {
                title: 'Access Denied',
                size: 'xsmall',
                severity: 'info',
                closeButton: 'hidden',
                backdropClose: false
            }
        }
    };
}

export function openOAuthUnauthorizedModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'oauth-unauthorized-modal',
                params: { }
            },
            options: {
                title: 'Access Denied',
                size: 'xsmall',
                severity: 'info',
                closeButton: 'hidden',
                backdropClose: false
            }
        }
    };
}
/** INJECT:actionCreator **/

