import { dispatch } from 'state-actions';

export function updateModal(options) {
    dispatch({ type: 'UPDATE_MODAL', ...options });
}

export function lockActiveModal() {
    dispatch({ type: 'LOCK_ACTIVE_MODAL' });
}

export function closeActiveModal() {
    dispatch({ type: 'CLOSE_ACTIVE_MODAL' });
}

export function openInstallNodesModal() {
    dispatch({
        type: 'OPEN_MODAL',
        component: 'install-nodes-modal',
        options: {
            title: 'Install Nodes',
            size: 'medium'
        }
    });
}

export function openAddCloudResrouceModal() {
    dispatch({
        type: 'OPEN_MODAL',
        component: 'add-cloud-resource-modal',
        options: {
            title: 'Add Cloud Resource',
            size: 'medium'
        }
    });
}

export function openAddCloudConnectionModal() {
    dispatch({
        type: 'OPEN_MODAL',
        component: 'add-cloud-connection-modal',
        options: {
            title: 'Add Cloud Connection',
            size: 'medium'
        }
    });
}

export function openSetCloudSyncModal(bucketName) {
    dispatch({
        type: 'OPEN_MODAL',
        component: {
            name: 'set-cloud-sync-modal',
            params: { bucketName }
        },
        options: {
            title: 'Set Cloud Sync',
            size: 'medium'
        }
    });
}

export function openEditCloudSyncModal(bucketName) {
    dispatch({
        type: 'OPEN_MODAL',
        component: {
            name: 'edit-cloud-sync-modal',
            params: { bucketName }
        },
        options: {
            title: 'Edit Cloud Sync Policy'
        }
    });
}

export function openS3AccessDetailsModal(accountEmail) {
    dispatch({
        type: 'OPEN_MODAL',
        component: {
            name: 's3-access-details-modal',
            params: { accountEmail }
        },
        options: {
            title: 'Connection Details',
            size: 'xsmall'
        }
    });
}

export function openBucketS3AccessModal(bucketName) {
    dispatch({
        type: 'OPEN_MODAL',
        component: {
            name: 'bucket-s3-access-modal',
            params: { bucketName }
        },
        options: {
            title: 'Bucket S3 Access'
        }
    });
}

export function openBucketPlacementPolicyModal(bucketName) {
    dispatch({
        type: 'OPEN_MODAL',
        component: {
            name: 'bucket-placement-policy-modal',
            params: { bucketName }
        },
        options: {
            title: 'Bucket Data Placement Policy',
            size: 'large'
        }
    });
}

export function openFileUploadsModal() {
    dispatch({
        type: 'OPEN_MODAL',
        component: 'file-uploads-modal',
        options: {
            title: 'File Uploads',
            size: 'large'
        }
    });
}

export function openDeleteCurrentAccountWarningModal() {
    dispatch({
        type: 'OPEN_MODAL',
        component: 'delete-current-account-warning-modal',
        options: {
            title: 'Deleting Current Account',
            severity: 'warning',
            size: 'xsmall'
        }
    });
}

export function openStartMaintenanceModal() {
    dispatch({
        type: 'OPEN_MODAL',
        component: 'start-maintenance-modal',
        options: {
            title: 'Maintenance Mode',
            size: 'xsmall'
        }
    });
}

export function openObjectPreviewModal(objectUri) {
    dispatch({
        type: 'OPEN_MODAL',
        component: {
            name: 'object-preview-modal',
            params: { objectUri }
        },
        options: {
            size: 'large'
        }
    });
}

export function openTestNodeModal(nodeRpcAddress) {
    dispatch({
        type: 'OPEN_MODAL',
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
    });
}

export function openEditServerDNSSettingsModal(serverSecret) {
    dispatch({
        type: 'OPEN_MODAL',
        component: {
            name: 'edit-server-dns-settings-modal',
            params: { serverSecret }
        },
        options: {
            title: 'Edit Server DNS Settings'
        }
    });
}

export function openEditServerTimeSettingsModal(serverSecret) {
    dispatch({
        type: 'OPEN_MODAL',
        component: {
            name: 'edit-server-time-settings-modal',
            params: { serverSecret }
        },
        options: {
            title: 'Edit Server Time Settings'
        }
    });
}

export function openEditAccountS3AccessModal(accountEmail) {
    dispatch({
        type: 'OPEN_MODAL',
        component: {
            name: 'edit-account-s3-access-modal',
            params: { accountEmail }
        },
        options: {
            title: 'Account S3 Access'
        }
    });
}

export function openEditServerDetailsModal(serverSecret) {
    dispatch({
        type: 'OPEN_MODAL',
        component: {
            name: 'edit-server-details-modal',
            params: { serverSecret }
        },
        options: {
            size: 'xsmall',
            title: 'Edit Server Details'
        }
    });
}

export function openAssignNodesModal(poolName) {
    dispatch({
        type: 'OPEN_MODAL',
        component: {
            name: 'assign-nodes-modal',
            params: { poolName }
        },
        options: {
            size: 'auto-height',
            title: 'Assign Nodes'
        }
    });
}

export function openUpdateSystemNameModal(name) {
    dispatch({
        type: 'OPEN_MODAL',
        component: {
            name: 'update-system-name-modal',
            params: { name }
        },
        options: {
            size: 'xsmall',
            title: 'Updating System Name'
        }
    });
}

export function openUnableToActivateModal(reason) {
    dispatch({
        type: 'OPEN_MODAL',
        component: {
            name: 'unable-to-activate-modal',
            params: { reason }
        },
        options: {
            size: 'small',
            title: 'NooBaa\'s Activation Servers Unreachable'
        }
    });
}

export function openCreateAccountModal() {
    dispatch({
        type: 'OPEN_MODAL',
        component: 'create-account-modal',
        options: {
            size: 'medium',
            title: 'Create Account'
        }
    });
}
