import { dispatch } from 'state-actions';

/// -------------------------------
/// Drawer action dispatchers
/// -------------------------------
export function openDrawer(component) {
    dispatch({ type: 'DRAWER_OPEN', component });
}

export function closeDrawer() {
    dispatch({ type: 'DRAWER_CLOSE' });
}

/// -------------------------------
/// Modal action dispatchers
/// -------------------------------

export function updateModal(options) {
    dispatch({ type: 'MODAL_UPDATE', ...options });
}

export function closeModal() {
    dispatch({ type: 'MODAL_CLOSE' });
}

export function openInstallNodesModal() {
    dispatch({
        type: 'MODAL_OPEN',
        component: 'install-nodes-modal',
        options: {
            title: 'Install Nodes',
            size: 'medium'
        }
    });
}

export function openAfterUpgradeModal() {
    dispatch({
        type: 'MODAL_OPEN',
        component: 'after-upgrade-modal',
        options: {
            size: 'xsmall'
        }
    });
}

export function openUpgradedCapacityNofiticationModal() {
    dispatch({
        type: 'MODAL_OPEN',
        component: 'upgraded-capacity-notification-modal',
        options: {
            size: 'small',
            backdropClose: false
        }
    });
}

export function openWelcomeModal() {
    dispatch({
        type: 'MODAL_OPEN',
        component: 'welcome-modal',
        options: {
            size: 'custom',
            backdropClose: false
        }
    });
}

export function openAddCloudResrouceModal() {
    dispatch({
        type: 'MODAL_OPEN',
        component: 'add-cloud-resource-modal',
        options: {
            title: 'Add Cloud Resource',
            size: 'medium'
        }
    });
}

export function openAddCloudConnectionModal() {
    dispatch({
        type: 'MODAL_OPEN',
        component: 'add-cloud-connection-modal',
        options: {
            title: 'Add Cloud Connection',
            size: 'medium'
        }
    });
}

export function openSetCloudSyncModal(bucketName) {
    dispatch({
        type: 'MODAL_OPEN',
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
        type: 'MODAL_OPEN',
        component: {
            name: 'edit-cloud-sync-modal',
            params: { bucketName }
        },
        options: {
            title: 'Edit Cloud Sync Policy'
        }
    });
}

export function openS3AccessDetailsModal(email) {
    dispatch({
        type: 'MODAL_OPEN',
        component: {
            name: 's3-access-details-modal',
            params: { email }
        },
        options: {
            title: 'Connection Details',
            size: 'xsmall'
        }
    });
}

export function openBucketS3AccessModal(bucketName) {
    dispatch({
        type: 'MODAL_OPEN',
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
        type: 'MODAL_OPEN',
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
