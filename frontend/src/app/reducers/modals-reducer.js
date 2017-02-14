import { createReducer } from 'utils/reducer-utils';
import { pick, last } from 'utils/core-utils';

// ------------------------------
// Action Handlers
// ------------------------------
function onApplicationInit() {
    return [];
}

function onModalUpdate(modals, action) {
    if (modals.length > 0) {
        const update = pick(
            action,
            'title',
            'size',
            'severity',
            'closeButton',
            'backdropClose',
        );

        return [
            ...modals.slice(0, -1),
            { ...last(modals), ...update }
        ];
    } else {
        return modals;
    }
}

function onCloseActiveModal(modals) {
    return modals.slice(0, -1);
}

function onLockActiveModal(modals) {
    const backdropClose = false;
    const closeButton = 'disabled';
    return [
        ...modals.slice(0, -1),
        { ...last(modals), backdropClose, closeButton }
    ];
}

function onOpenInstallNodesModal(modals) {
    return _openModal(modals, {
        component: 'install-nodes-modal',
        options: {
            title: 'Install Nodes',
            size: 'medium'
        }
    });
}

function onOpenAfterUpgradeModal(modals) {
    return _openModal(modals, {
        component: 'after-upgrade-modal',
        options: {
            size: 'xsmall'
        }
    });
}

function onOpenUpgradedCapacityNofiticationModal(modals) {
    return _openModal(modals, {
        component: 'upgraded-capacity-notification-modal',
        options: {
            backdropClose: false
        }
    });
}

function onOpenWelcomeModal(modals) {
    return _openModal(modals, {
        component: 'welcome-modal',
        options: {
            size: 'custom',
            backdropClose: false
        }
    });
}

function onOpenAddCloudResrouceModal(modals) {
    return _openModal(modals, {
        component: 'add-cloud-resource-modal',
        options: {
            title: 'Add Cloud Resource',
            size: 'medium'
        }
    });
}

function onOpenAddCloudConnectionModal(modals) {
    return _openModal(modals, {
        component: 'add-cloud-connection-modal',
        options: {
            title: 'Add Cloud Connection',
            size: 'medium'
        }
    });
}

function onOpenSetCloudSyncModal(modals, { bucketName }) {
    return _openModal(modals, {
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

function onOpenEditCloudSyncModal(modals, { bucketName }) {
    return _openModal(modals, {
        component: {
            name: 'edit-cloud-sync-modal',
            params: { bucketName }
        },
        options: {
            title: 'Edit Cloud Sync Policy'
        }
    });
}

function onOpenS3AccessDetailsModal(modals, { accountEmail }) {
    return _openModal(modals, {
        type: 'MODAL_OPEN',
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

function onOpenBucketS3AccessModal(modals, { bucketName }) {
    return _openModal(modals, {
        component: {
            name: 'bucket-s3-access-modal',
            params: { bucketName }
        },
        options: {
            title: 'Bucket S3 Access'
        }
    });
}

function onOpenBucketPlacementPolicyModal(modals, { bucketName }) {
    return _openModal(modals, {
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

function onOpenFileUploadsModal(modals) {
    return _openModal(modals, {
        component: 'file-uploads-modal',
        options: {
            title: 'File Uploads',
            size: 'large'
        }
    });
}

function onOpenDeleteCurrentAccountWarningModal(modals) {
    return _openModal(modals, {
        component: 'delete-current-account-warning-modal',
        options: {
            title: 'Deleting Current Account',
            severity: 'warning',
            size: 'xsmall'
        }
    });
}

function onOpenStartMaintenanceModal(modals) {
    return _openModal(modals, {
        component: 'start-maintenance-modal',
        options: {
            title: 'Maintenance Mode',
            size: 'xsmall'
        }
    });
}

function onOpenObjectPreviewModal(modals, { objectUri }) {
    return _openModal(modals, {
        component: {
            name: 'object-preview-modal',
            params: { objectUri }
        },
        options: {
            size: 'large'
        }
    });
}

function onOpenTestNodeModal(modals, { nodeRpcAddress }) {
    return _openModal(modals, {
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

function onOpenEditServerDNSSettingsModal(modals, { serverSecret }) {
    return _openModal(modals, {
        component: {
            name: 'edit-server-dns-settings-modal',
            params: { serverSecret }
        },
        options: {
            title: 'Edit Server DNS Settings'
        }
    });
}

function onOpenEditServerTimeSettingsModal(modals, { serverSecret }) {
    return _openModal(modals, {
        component: {
            name: 'edit-server-time-settings-modal',
            params: { serverSecret }
        },
        options: {
            title: 'Edit Server Time Settings'
        }
    });
}

function onOpenEditAccountS3AccessModal(modals, { accountEmail }) {
    return _openModal(modals, {
        component: {
            name: 'edit-account-s3-access-modal',
            params: { accountEmail }
        },
        options: {
            title: 'Account S3 Access'
        }
    });
}

function onOpenEditServerDetailsModal(modals, { serverSecret }) {
    return _openModal(modals, {
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

function onOpenAssignNOdesModal(modals, { poolName }) {
    return _openModal(modals, {
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

function onOpenUpdateSystemNameModal(modals, { name }) {
    return _openModal(modals, {
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

// ------------------------------
// Local util functions
// ------------------------------
function _openModal(modals, { component = 'empty', options = {} }) {
    const { name = component, params = {} } = component;
    const {
        title = '',
        size = 'small',
        severity = '',
        closeButton = 'visible',
        backdropClose = true
    } = options;

    return [
        ...modals,
        { component: { name, params }, title, size, severity,
            backdropClose, closeButton }
    ];
}

// ------------------------------
// Exported reducer function.
// ------------------------------
export default createReducer({
    // TODO REMOVE THIS ACITON
    MODAL_UPDATE: onModalUpdate,

    APPLICATION_INIT: onApplicationInit,
    CLOSE_ACTIVE_MODAL: onCloseActiveModal,
    LOCK_ACTIVE_MODAL: onLockActiveModal,
    OPEN_INSTALL_NODES_MODAL: onOpenInstallNodesModal,
    OPEN_AFTER_UPGRADE_MODAL: onOpenAfterUpgradeModal,
    OPEN_UPGRADED_CAPACITY_NOFITICATION_MODAL: onOpenUpgradedCapacityNofiticationModal,
    OPEN_WELCOME_MODAL: onOpenWelcomeModal,
    OPEN_ADD_CLOUD_RESROUCE_MODAL: onOpenAddCloudResrouceModal,
    OPEN_ADD_CLOUD_CONNECTION_MODAL: onOpenAddCloudConnectionModal,
    OPEN_SET_CLOUD_SYNC_MODAL: onOpenSetCloudSyncModal,
    OPEN_EDIT_CLOUD_SYNC_MODAL: onOpenEditCloudSyncModal,
    OPEN_S3_ACCESS_DETAILS_MODAL: onOpenS3AccessDetailsModal,
    OPEN_BUCKET_S3_ACCESS_MODAL: onOpenBucketS3AccessModal,
    OPEN_BUCKET_PLACEMENT_POLICY_MODAL: onOpenBucketPlacementPolicyModal,
    OPEN_FILE_UPLOADS_MODAL: onOpenFileUploadsModal,
    OPEN_DELETE_CURRENT_ACCOUNT_WARNING_MODAL: onOpenDeleteCurrentAccountWarningModal,
    START_MAINTENANCE_MODAL: onOpenStartMaintenanceModal,
    OPEN_OBJECT_PREVIEW_MODAL: onOpenObjectPreviewModal,
    OPEN_TEST_NODE_MODAL: onOpenTestNodeModal,
    OPEN_EDIT_SERVER_DNS_SETTINGS_MODAL: onOpenEditServerDNSSettingsModal,
    OPEN_EDIT_SERVER_TIME_SETTINGS_MODAL: onOpenEditServerTimeSettingsModal,
    OPEN_EDIT_ACCOUNT_S3_ACCESS_MODAL: onOpenEditAccountS3AccessModal,
    OPEN_EDIT_SERVER_DETAILS_MODAL: onOpenEditServerDetailsModal,
    OPEN_ASSIGN_NODES_MODAL: onOpenAssignNOdesModal,
    OPEN_UPDATE_SYSTEM_NAME_MODAL: onOpenUpdateSystemNameModal
});
