import { dispatch } from 'state-actions';

/// -------------------------------
/// Drawer action dispatchers
/// -------------------------------
export function openAuditDrawer() {
    dispatch({ type: 'OPEN_AUDIT_DRAWER' });
}

export function openAlertsDrawer() {
    dispatch({ type: 'OPEN_ALERTS_DRAWER' });
}

export function closeActiveDrawer() {
    dispatch({ type: 'CLOSE_ACTIVE_DRAWER' });
}

/// -------------------------------
/// Modal action dispatchers
/// -------------------------------

export function updateModal(options) {
    dispatch({ type: 'MODAL_UPDATE', ...options });
}

export function closeActiveModal() {
    dispatch({ type: 'CLOSE_ACTIVE_MODAL' });
}

export function lockActiveModal() {
    dispatch({ type: 'LOCK_ACTIVE_MODAL' });
}

export function openInstallNodesModal() {
    dispatch({ type: 'OPEN_INSTALL_NODES_MODAL' });
}

export function openAfterUpgradeModal() {
    dispatch({ type: 'OPEN_AFTER_UPGRADE_MODAL' });
}

export function openUpgradedCapacityNofiticationModal() {
    dispatch({ type: 'OPEN_UPGRADED_CAPACITY_NOFITICATION_MODAL' });
}

export function openWelcomeModal() {
    dispatch({ type: 'OPEN_WELCOME_MODAL' });
}

export function openAddCloudResrouceModal() {
    dispatch({ type: 'OPEN_ADD_CLOUD_RESROUCE_MODAL' });
}

export function openAddCloudConnectionModal() {
    dispatch({ type: 'OPEN_ADD_CLOUD_CONNECTION_MODAL' });
}

export function openSetCloudSyncModal(bucketName) {
    dispatch({ type: 'OPEN_SET_CLOUD_SYNC_MODAL', bucketName });
}

export function openEditCloudSyncModal(bucketName) {
    dispatch({ type: 'OPEN_EDIT_CLOUD_SYNC_MODAL', bucketName });
}

export function openS3AccessDetailsModal(accountEmail) {
    dispatch({ type: 'OPEN_S3_ACCESS_DETAILS_MODAL', accountEmail });
}

export function openBucketS3AccessModal(bucketName) {
    dispatch({ type: 'OPEN_BUCKET_S3_ACCESS_MODAL', bucketName });
}

export function openBucketPlacementPolicyModal(bucketName) {
    dispatch({ type: 'OPEN_BUCKET_PLACEMENT_POLICY_MODAL', bucketName });
}

export function openFileUploadsModal() {
    dispatch({ type: 'OPEN_FILE_UPLOADS_MODAL' });
}

export function openDeleteCurrentAccountWarningModal() {
    dispatch({ type: 'OPEN_DELETE_CURRENT_ACCOUNT_WARNING_MODAL' });
}

export function openStartMaintenanceModal() {
    dispatch({ type: 'START_MAINTENANCE_MODAL' });
}

export function openObjectPreviewModal(objectUri) {
    dispatch({ type: 'OPEN_OBJECT_PREVIEW_MODAL', objectUri });
}

export function openTestNodeModal(nodeRpcAddress) {
    dispatch( { type: 'OPEN_TEST_NODE_MODAL', nodeRpcAddress });
}

export function openEditServerDNSSettingsModal(serverSecret) {
    dispatch( { type: 'OPEN_EDIT_SERVER_DNS_SETTINGS_MODAL', serverSecret });
}

export function openEditServerTimeSettingsModal(serverSecret) {
    dispatch( { type: 'OPEN_EDIT_SERVER_TIME_SETTINGS_MODAL', serverSecret });
}

export function openEditAccountS3AccessModal(accountEmail) {
    dispatch( { type: 'OPEN_EDIT_ACCOUNT_S3_ACCESS_MODAL', accountEmail });
}

export function openEditServerDetailsModal(serverSecret) {
    dispatch( { type: 'OPEN_EDIT_SERVER_DETAILS_MODAL', serverSecret });
}

export function openAssignNodesModal(poolName) {
    dispatch( { type: 'OPEN_ASSIGN_NODES_MODAL', poolName });
}

export function openUpdateSystemNameModal(name) {
    dispatch( { type: 'OPEN_UPDATE_SYSTEM_NAME_MODAL', name });
}
