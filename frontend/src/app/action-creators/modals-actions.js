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

export function closeModal() {
    return { type: CLOSE_MODAL };
}

export function openInstallNodesModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'install-nodes-modal',
            options: {
                title: 'Install Nodes',
                size: 'medium'
            }
        }
    };
}

export function openAddCloudResrouceModal() {
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

export function openSetCloudSyncModal(bucketName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'set-cloud-sync-modal',
                params: { bucketName }
            },
            options: {
                title: 'Set Cloud Sync',
                size: 'medium'
            }
        }
    };
}

export function openEditCloudSyncModal(bucketName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-cloud-sync-modal',
                params: { bucketName }
            },
            options: {
                title: 'Edit Cloud Sync Policy'
            }
        }
    };
}

export function openS3AccessDetailsModal(email) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 's3-access-details-modal',
                params: { email }
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
                name: 'bucket-s3-access-modal',
                params: { bucketName }
            },
            options: {
                title: 'Bucket S3 Access'
            }
        }
    };
}

export function openBucketPlacementPolicyModal(bucketName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'bucket-placement-policy-modal',
                params: { bucketName }
            },
            options: {
                title: 'Bucket Data Placement Policy',
                size: 'large'
            }
        }
    };
}

export function openEditBucketPlacementModal(bucketName) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'edit-bucket-placement-modal',
                params: { bucketName }
            },
            options: {
                title: 'Edit Placement Policy',
                size: 'medium'
            }
        }
    };
}

export function openEmptyBucketPlacementWarningModal(action) {
    return {
        type: OPEN_MODAL,
        payload: {
            component: {
                name: 'empty-bucket-placement-warning-modal',
                params: { action }
            },
            options: {
                title: 'Empty data placement policy',
                size: 'xsmall',
                severity: 'warning'
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
                title: 'Edit Bucket Quota'
            }
        }

    };
}

export function replaceToAccountCreatedModal(accountName, password) {
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

export function openSetAccountIpRestrictions(accountName) {
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
                size: 'medium',
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

export function openEditSpilloverTargetsModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'edit-spillover-targets-modal',
            options: {
                title: 'Edit Spillover Targets',
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

export function openUpgradeSystemModal() {
    return {
        type: OPEN_MODAL,
        payload: {
            component: 'upgrade-system-modal',
            options: {
                title: 'Upgrade NooBaa Version',
                size: 'medium'
            }
        }
    };
}

export function replaceToPreUpgradeSystemFailedModal() {
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

export function replaceToUpgradeSystemFailedModal() {
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
