/* Copyright (C) 2016 NooBaa */

import { isFunction } from 'utils/core-utils';
import { toDashedCase } from 'utils/string-utils';

// -------------------------------
// Top level components
// -------------------------------
import app from './application/app/app';
import mainLayout from './application/main-layout/main-layout';
import loginLayout from './application/login-layout/login-layout';
import modalManager from './application/modal-manager/modal-manager';
import exitConfirmationMessage from './application/exit-confirmation-message/exit-confirmation-message';
/** INJECT:application.import **/

// -------------------------------
// Login layout components
// -------------------------------
import signinForm from './login/signin-form/signin-form';
import createSystemForm from './login/create-system-form/create-system-form';
import unsupportedForm from './login/unsupported-form/unsupported-form';
import unableToActivateModal from './login/unable-to-activate-modal/unable-to-activate-modal';
import internetConnectivityProblemForm from './login/internet-connectivity-problem-form/internet-connectivity-problem-form';
import changePasswordForm from './login/change-password-form/change-password-form';
import splashScreen from './login/splash-screen/splash-screen';
/** INJECT:login.import **/

// -------------------------------
// Main layout components
// -------------------------------
import commandsBar from './main/commands-bar/commands-bar';
import notificationBox from './main/notification-box/notification-box';
import accountMenu from './main/account-menu/account-menu';
import uploadsIndicator from './main/uploads-indicator/uploads-indicator';
/** INJECT:main.import **/

// -------------------------------
// Sticky components
// -------------------------------
import debugModeSticky from './stickies/debug-mode-sticky/debug-mode-sticky';
import maintenanceSticky from './stickies/maintenance-sticky/maintenance-sticky';
import phoneHomeConnectivitySticky from './stickies/phone-home-connectivity-sticky/phone-home-connectivity-sticky';
import clusterAvailabilitySticky from './stickies/cluster-availability-sticky/cluster-availability-sticky';
import preferedBrowsersSticky from './stickies/prefered-browsers-sticky/prefered-browsers-sticky';
import ipCollisionSticky from './stickies/ip-collision-sticky/ip-collision-sticky';
/** INJECT:stickies.import **/

// -------------------------------
// Modal components
// -------------------------------
import installNodesModal from './modals/install-nodes-modal/install-nodes-modal';
import installNodesToPoolModal from './modals/install-nodes-to-pool-modal/install-nodes-to-pool-modal';
import welcomeModal from './modals/welcome-modal/welcome-modal';
import afterUpgradeModal from './modals/after-upgrade-modal/after-upgrade-modal';
import addCloudResourceModal from './modals/add-cloud-resource-modal/add-cloud-resource-modal';
import addCloudConnectionModal from './modals/add-cloud-connection-modal/add-cloud-connection-modal';
import s3AccessDetailsModal from './modals/s3-access-details-modal/s3-access-details-modal';
import editBucketS3AccessModal from './modals/edit-bucket-s3-access-modal/edit-bucket-s3-access-modal';
import startMaintenanceModal from './modals/start-maintenance-modal/start-maintenance-modal';
import fileUploadsModal from './modals/file-uploads-modal/file-uploads-modal';
import deleteCurrentAccountWarningModal from './modals/delete-current-account-warning-modal/delete-current-account-warning-modal';
import objectPreviewModal from './modals/object-preview-modal/object-preview-modal';
import testNodeModal from './modals/test-node-modal/test-node-modal';
import editServerDnsSettingsModal from './modals/edit-server-dns-settings-modal/edit-server-dns-settings-modal';
import editServerTimeSettingsModal from './modals/edit-server-time-settings-modal/edit-server-time-settings-modal';
import editAccountS3AccessModal from './modals/edit-account-s3-access-modal/edit-account-s3-access-modal';
import editServerDetailsModal from './modals/edit-server-details-modal/edit-server-details-modal';
import assignHostsModal from './modals/assign-hosts-modal/assign-hosts-modal';
import updateSystemNameModal from './modals/update-system-name-modal/update-system-name-modal';
import createAccountModal from './modals/create-account-modal/create-account-modal';
import accountCreatedModal from './modals/account-created-modal/account-created-modal';
import editBucketQuotaModal from './modals/edit-bucket-quota-modal/edit-bucket-quota-modal';
import setAccountIpRestrictionsModal from './modals/set-account-ip-restrictions-modal/set-account-ip-restrictions-modal';
import createPoolModal from './modals/create-pool-modal/create-pool-modal';
import editHostStorageDrivesModal from './modals/edit-host-storage-drives-modal/edit-host-storage-drives-modal';
import disableHostEndpointWarningModal from './modals/disable-host-endpoint-warning-modal/disable-host-endpoint-warning-modal';
import disableHostStorageWarningModal from './modals/disable-host-storage-warning-modal/disable-host-storage-warning-modal';
import disableHostLastServiceWarningModal from './modals/disable-host-last-service-warning-modal/disable-host-last-service-warning-modal';
import connectAppModal from './modals/connect-app-modal/connect-app-modal';
import createNamespaceResourceModal from './modals/create-namespace-resource-modal/create-namespace-resource-modal';
import createNamespaceBucketModal from './modals/create-namespace-bucket-modal/create-namespace-bucket-modal';
import editNamespaceBucketDataPlacementModal from './modals/edit-namespace-bucket-data-placement-modal/edit-namespace-bucket-data-placement-modal';
import emptyDataPlacementWarningModal from './modals/empty-data-placement-warning-modal/empty-data-placement-warning-modal';
import setNodeAsTrustedModal from './modals/set-node-as-trusted-modal/set-node-as-trusted-modal';
import confirmDeleteHostModal from './modals/confirm-delete-host-modal/confirm-delete-host-modal';
import upgradeSystemModal from './modals/upgrade-system-modal/upgrade-system-modal';
import upgradingSystemModal from './modals/upgrading-system-modal/upgrading-system-modal';
import upgradeSystemFailedModal from './modals/upgrade-system-failed-modal/upgrade-system-failed-modal';
import preUpgradeSystemFailedModal from './modals/pre-upgrade-system-failed-modal/pre-upgrade-system-failed-modal';
import finalizeUpgradeModal from './modals/finalize-upgrade-modal/finalize-upgrade-modal';
import editBucketDataResiliencyModal from './modals/edit-bucket-data-resiliency-modal/edit-bucket-data-resiliency-modal';
import riskyBucketDataResiliencyWarningModal from './modals/risky-bucket-data-resiliency-warning-modal/risky-bucket-data-resiliency-warning-modal';
import changeClusterConnectivityIpModal from './modals/change-cluster-connectivity-ip-modal/change-cluster-connectivity-ip-modal';
import managementConsoleErrorModal from './modals/management-console-error-modal/management-console-error-modal';
import addBucketTriggerModal from './modals/add-bucket-trigger-modal/add-bucket-trigger-modal';
import editBucketTriggerModal from './modals/edit-bucket-trigger-modal/edit-bucket-trigger-modal';
import attachServerModal from './modals/attach-server-modal/attach-server-modal';
import createFuncModal from './modals/create-func-modal/create-func-modal';
import afterUpgradeFailureModal from './modals/after-upgrade-failure-modal/after-upgrade-failure-modal';
import createBucketModal from './modals/create-bucket-modal/create-bucket-modal';
import assignRegionModal from './modals/assign-region-modal/assign-region-modal';
import changePasswordModal from './modals/change-password-modal/change-password-modal';
import resetPasswordModal from './modals/reset-password-modal/reset-password-modal';
import passwordResetCompletedModal from './modals/password-reset-completed-modal/password-reset-completed-modal';
import passwordResetFailedModal from './modals/password-reset-failed-modal/password-reset-failed-modal';
import editFuncConfigModal from './modals/edit-func-config-modal/edit-func-config-modal';
import invokeFuncModal from './modals/invoke-func-modal/invoke-func-modal';
import editFuncCodeModal from './modals/edit-func-code-modal/edit-func-code-modal';
import bucketPlacementSummaryModal from './modals/bucket-placement-summary-modal/bucket-placement-summary-modal';
import keepUsingInternalStorageModal from './modals/keep-using-internal-storage-modal/keep-using-internal-storage-modal';
/** INJECT:modals.import **/

// -------------------------------
// Overview page components
// -------------------------------
import overviewPanel from './overview/overview-panel/overview-panel';
import bucketsOverview from './overview/buckets-overview/buckets-overview';
import resourceOverview from './overview/resource-overview/resource-overview';
import systemHealth from './overview/system-health/system-health';
/** INJECT:overview.import **/

// -------------------------------
// Buckets page components
// -------------------------------
import bucketsPanel from './buckets/buckets-panel/buckets-panel';
import bucketsTable from './buckets/buckets-table/buckets-table';
import namespaceBucketsTable from './buckets/namespace-buckets-table/namespace-buckets-table';

// -------------------------------
// Bucket page components
// -------------------------------
import bucketPanel from './bucket/bucket-panel/bucket-panel';
import bucketSummary from './bucket/bucket-summary/bucket-summary';
import bucketObjectsTable from './bucket/bucket-objects-table/bucket-objects-table';
import bucketDataPoliciesForm from './bucket/bucket-data-policies-form/bucket-data-policies-form';
import bucketDataResiliencyPolicyForm from './bucket/bucket-data-resiliency-policy-form/bucket-data-resiliency-policy-form';
import bucketQuotaPolicyForm from './bucket/bucket-quota-policy-form/bucket-quota-policy-form';
import bucketVersioningPolicyForm from './bucket/bucket-versioning-policy-form/bucket-versioning-policy-form';
import bucketS3AccessPolicyForm from './bucket/bucket-s3-access-policy-form/bucket-s3-access-policy-form';
import bucketTriggersForm from './bucket/bucket-triggers-form/bucket-triggers-form';
import bucketDataPlacementForm from './bucket/bucket-data-placement-form/bucket-data-placement-form';
import tierDataPlacementPolicyForm from './bucket/tier-data-placement-policy-form/tier-data-placement-policy-form';
import editTierDataPlacementModal from './bucket/edit-tier-data-placement-modal/edit-tier-data-placement-modal';
import addTierModal from './bucket/add-tier-modal/add-tier-modal';
/** INJECT:bucket.import **/

// -------------------------------
// Namespace bucket page components
// -------------------------------
import namespaceBucketPanel from './namespace-bucket/namespace-bucket-panel/namespace-bucket-panel';
import namespaceBucketSummary from './namespace-bucket/namespace-bucket-summary/namespace-bucket-summary';
import namespaceBucketDataPlacementForm from './namespace-bucket/namespace-bucket-data-placement-form/namespace-bucket-data-placement-form';
import namespaceBucketS3AccessForm from './namespace-bucket/namespace-bucket-s3-access-form/namespace-bucket-s3-access-form';
/** INJECT:namespace-bucket.import **/

// -------------------------------
// Object page components
// -------------------------------
import objectPanel from './object/object-panel/object-panel';
import objectSummary from './object/object-summary/object-summary';
import objectProperties from './object/object-properties/object-properties';
import objectPartsList from './object/object-parts-list/object-parts-list';
/** INJECT:object.import **/

// -------------------------------
// Resources page components
// -------------------------------
import resourcesPanel from './resources/resources-panel/resources-panel';
import poolsTable from './resources/pools-table/pools-table';
import cloudResourcesTable from './resources/cloud-resources-table/cloud-resources-table';
import namespaceResourcesTable from './resources/namespace-resources-table/namespace-resources-table';
/** INJECT:resources.import **/

// -------------------------------
// Pool page components
// -------------------------------
import poolPanel from './pool/pool-panel/pool-panel';
import poolSummary from './pool/pool-summary/pool-summary';
import poolHostsTable from './pool/pool-hosts-table/pool-hosts-table';
/** INJECT:pool.import **/

// -------------------------------
// Cloud resource page components
// -------------------------------
import cloudResourcePanel from './cloud-resource/cloud-resource-panel/cloud-resource-panel';
import cloudResourceSummary from './cloud-resource/cloud-resource-summary/cloud-resource-summary';
import cloudResourcePropertiesForm from './cloud-resource/cloud-resource-properties-form/cloud-resource-properties-form';
/** INJECT:cloud-resource.import **/

// -------------------------------
// Host page components
// -------------------------------
import hostPanel from './host/host-panel/host-panel';
import hostSummary from './host/host-summary/host-summary';
import hostDetailsForm from './host/host-details-form/host-details-form';
import hostEndpointForm from './host/host-endpoint-form/host-endpoint-form';
import hostStorageForm from './host/host-storage-form/host-storage-form';
import hostDiagnosticsForm from './host/host-diagnostics-form/host-diagnostics-form';
/** INJECT:host.import **/

// -------------------------------
// Management page components
// -------------------------------
import managementPanel from './management/management-panel/management-panel';
import p2pForm from './management/p2p-form/p2p-form';
import systemAddressForm from './management/system-address-form/system-address-form';
import versionForm from './management/version-form/version-form';
import diagnosticsForm from './management/diagnostics-form/diagnostics-form';
import maintenanceForm from './management/maintenance-form/maintenance-form';
import proxyServerForm from './management/proxy-server-form/proxy-server-form';
import remoteSyslogForm from './management/remote-syslog-form/remote-syslog-form';
import serverSslForm from './management/server-ssl-form/server-ssl-form';
import serverTimeForm from './management/server-time-form/server-time-form';
import serverDnsSettingsForm from './management/server-dns-settings-form/server-dns-settings-form';
import vmToolsForm from './management/vm-tools-form/vm-tools-form';
/** INJECT:management.import **/

// -------------------------------
// Accounts page components
// -------------------------------
import accountsPanel from './accounts/accounts-panel/accounts-panel';
import accountsTable from './accounts/accounts-table/accounts-table';
/** INJECT:accounts.import **/

// -------------------------------
// Account page components
// -------------------------------
import accountPanel from './account/account-panel/account-panel';
import accountDetailsForm from './account/account-details-form/account-details-form';
import accountS3AccessForm from './account/account-s3-access-form/account-s3-access-form';
import regenerateAccountCredentialsModal from './account/regenerate-account-credentials-modal/regenerate-account-credentials-modal';
import accountConnectionsTable from './account/account-connections-table/account-connections-table';
/** INJECT:account.import **/

// -------------------------------
// Cluster page components
// -------------------------------
import clusterPanel from './cluster/cluster-panel/cluster-panel';
import serverTable from './cluster/server-table/server-table';
import clusterSummary from './cluster/cluster-summary/cluster-summary';
/** INJECT:cluster.import **/

// -------------------------------
// Server page components
// -------------------------------
import serverPanel from './server/server-panel/server-panel';
import serverSummary from './server/server-summary/server-summary';
import serverDetailsForm from './server/server-details-form/server-details-form';
import serverDiagnosticsForm from './server/server-diagnostics-form/server-diagnostics-form';
import serverCommunicationForm from './server/server-communication-form/server-communication-form';
/** INJECT:server.import **/

// -------------------------------
// Functions page components
// -------------------------------
import funcsPanel from './funcs/funcs-panel/funcs-panel';
import funcsTable from './funcs/funcs-table/funcs-table';
/** INJECT:funcs.import **/

// -------------------------------
// Function page components
// -------------------------------
import funcPanel from './func/func-panel/func-panel';
import funcSummary from './func/func-summary/func-summary';
import funcConfigForm from './func/func-config-form/func-config-form';
import funcMonitoring from './func/func-monitoring/func-monitoring';
import funcCodeForm from './func/func-code-form/func-code-form';
import funcMonitoringForm from './func/func-monitoring-form/func-monitoring-form';
/** INJECT:func.import **/

// -------------------------------
// Analytics page components
// -------------------------------
import analyticsPanel from './analytics/analytics-panel/analytics-panel';
import analyticsResourceDistributionForm from './analytics/analytics-resource-distribution-form/analytics-resource-distribution-form';
import bucketUsageForm from './analytics/bucket-usage-form/bucket-usage-form';
import accountUsageForm from './analytics/account-usage-form/account-usage-form';
import objectsDistributionForm from './analytics/objects-distribution-form/objects-distribution-form';
import cloudUsageStatsForm from './analytics/cloud-usage-stats-form/cloud-usage-stats-form';
import dataBreakdownForm from './analytics/data-breakdown-form/data-breakdown-form';
/** INJECT:analytics.import **/

// -------------------------------
// Admin components
// -------------------------------
import auditPane from './admin/audit-pane/audit-pane';
import alertsPane from './admin/alerts-pane/alerts-pane';
/** INJECT:admin.import **/

// -------------------------------
// Shared components
// -------------------------------
import svgIcon from './shared/svg-icon/svg-icon';
import modal from './shared/modal/modal';
import dropdown from './shared/dropdown/dropdown';
import radioBtn from './shared/radio-btn/radio-btn';
import radioGroup from './shared/radio-group/radio-group';
import checkbox from './shared/checkbox/checkbox';
import bar from './shared/bar/bar';
import progressBar from './shared/progress-bar/progress-bar';
import rangeIndicator from './shared/range-indicator/range-indicator';
import stepper from './shared/stepper/stepper';
import multiselect from './shared/multiselect/multiselect';
import slider from './shared/slider/slider';
import paginator from './shared/paginator/paginator';
import drawer from './shared/drawer/drawer';
import deleteButton from './shared/delete-button/delete-button';
import fileSelector from './shared/file-selector/file-selector';
import autocomplete from './shared/autocomplete/autocomplete';
import editor from './shared/editor/editor';
import toggleSwitch from './shared/toggle-switch/toggle-switch';
import propertySheet from './shared/property-sheet/property-sheet';
import capacityBar from './shared/capacity-bar/capacity-bar';
import toggleGroup from './shared/toggle-group/toggle-group';
import dataTable from './shared/data-table/data-table';
import timezoneChooser from './shared/timezone-chooser/timezone-chooser';
import dateTimeChooser from './shared/date-time-chooser/date-time-chooser';
import pieChart from './shared/pie-chart/pie-chart';
import barChart from './shared/bar-chart/bar-chart';
import chartLegend from './shared/chart-legend/chart-legend';
import copyToClipboardButton from './shared/copy-to-clipboard-button/copy-to-clipboard-button';
import passwordField from './shared/password-field/password-field';
import workingButton from './shared/working-button/working-button';
import collapsibleSection from './shared/collapsible-section/collapsible-section';
import chartjs from './shared/chartjs/chartjs';
import breadcrumbs from './shared/breadcrumbs/breadcrumbs';
import sideNav from './shared/side-nav/side-nav';
import tokenField from './shared/token-field/token-field';
import validationMessage from './shared/validation-message/validation-message';
import validationRulesList from './shared/validation-rules-list/validation-rules-list';
import validationIndicator from './shared/validation-indicator/validation-indicator';
import loadingIndicator from './shared/loading-indicator/loading-indicator';
import dropArea from './shared/drop-area/drop-area';
import wizard from './shared/wizard/wizard';
import wizardControls from './shared/wizard-controls/wizard-controls';
import managedForm from './shared/managed-form/managed-form';
import buttonGroup from './shared/button-group/button-group';
import resourceAssociatedAccountList from './shared/resource-associated-account-list/resource-associated-account-list';
import resourceConnectedBucketsForm from './shared/resource-connected-buckets-form/resource-connected-buckets-form';
import resourceDistributionTable from './shared/resource-distribution-table/resource-distribution-table';
import resourceDistributionChart from './shared/resource-distribution-chart/resource-distribution-chart';
import hostPartsTable from './shared/host-parts-table/host-parts-table';
import counter from './shared/counter/counter';
import listDetails from './shared/list-details/list-details';
import codeViewer from './shared/code-viewer/code-viewer';
import resourcesSelectionTable from './shared/resources-selection-table/resources-selection-table';
import placementPolicyToggle from './shared/placement-policy-toggle/placement-policy-toggle';
import tagList from './shared/tag-list/tag-list';
/** INJECT:shared.import **/

// Register the components with knockout component container.
export default function register(ko, services) {

    // A view model loader that inject services into the view model
    // constructors.
    function loadViewModel(name, vmConfig, callback) {
        if (isFunction(vmConfig)) {
            callback(params => new vmConfig(params, services));

        } else if (isFunction(vmConfig.createViewModel)) {
            callback((params, compInfo) =>
                vmConfig.createViewModel(params, compInfo, services)
            );

        } else {
            callback(null);
        }
    }

    // Register the custom loader.
    ko.components.loaders.unshift({ loadViewModel });

    // Register the components.
    Object.entries({
        app,
        mainLayout,
        loginLayout,
        modalManager,
        exitConfirmationMessage,
        /** INJECT:application.list **/

        signinForm,
        createSystemForm,
        unsupportedForm,
        unableToActivateModal,
        internetConnectivityProblemForm,
        changePasswordForm,
        splashScreen,
        /** INJECT:login.list **/

        commandsBar,
        notificationBox,
        accountMenu,
        uploadsIndicator,
        /** INJECT:main.list **/

        debugModeSticky,
        maintenanceSticky,
        phoneHomeConnectivitySticky,
        clusterAvailabilitySticky,
        preferedBrowsersSticky,
        ipCollisionSticky,
        /** INJECT:stickies.list **/

        installNodesModal,
        installNodesToPoolModal,
        welcomeModal,
        afterUpgradeModal,
        addCloudResourceModal,
        addCloudConnectionModal,
        s3AccessDetailsModal,
        editBucketS3AccessModal,
        startMaintenanceModal,
        fileUploadsModal,
        deleteCurrentAccountWarningModal,
        objectPreviewModal,
        testNodeModal,
        editServerDnsSettingsModal,
        editServerTimeSettingsModal,
        editAccountS3AccessModal,
        editServerDetailsModal,
        assignHostsModal,
        updateSystemNameModal,
        createAccountModal,
        accountCreatedModal,
        editBucketQuotaModal,
        setAccountIpRestrictionsModal,
        createPoolModal,
        editHostStorageDrivesModal,
        disableHostEndpointWarningModal,
        disableHostStorageWarningModal,
        disableHostLastServiceWarningModal,
        connectAppModal,
        createNamespaceResourceModal,
        createNamespaceBucketModal,
        editNamespaceBucketDataPlacementModal,
        emptyDataPlacementWarningModal,
        setNodeAsTrustedModal,
        confirmDeleteHostModal,
        upgradeSystemModal,
        upgradingSystemModal,
        upgradeSystemFailedModal,
        preUpgradeSystemFailedModal,
        finalizeUpgradeModal,
        editBucketDataResiliencyModal,
        riskyBucketDataResiliencyWarningModal,
        changeClusterConnectivityIpModal,
        managementConsoleErrorModal,
        addBucketTriggerModal,
        editBucketTriggerModal,
        attachServerModal,
        createFuncModal,
        afterUpgradeFailureModal,
        createBucketModal,
        assignRegionModal,
        changePasswordModal,
        resetPasswordModal,
        passwordResetCompletedModal,
        passwordResetFailedModal,
        editFuncConfigModal,
        invokeFuncModal,
        editFuncCodeModal,
        bucketPlacementSummaryModal,
        keepUsingInternalStorageModal,
        /** INJECT:modals.list **/

        overviewPanel,
        bucketsOverview,
        resourceOverview,
        systemHealth,
        /** INJECT:overview.list **/

        bucketsPanel,
        bucketsTable,
        namespaceBucketsTable,
        /** INJECT:buckets.list **/

        bucketPanel,
        bucketSummary,
        bucketObjectsTable,
        bucketDataPoliciesForm,
        bucketDataResiliencyPolicyForm,
        bucketQuotaPolicyForm,
        bucketVersioningPolicyForm,
        bucketS3AccessPolicyForm,
        bucketTriggersForm,
        bucketDataPlacementForm,
        tierDataPlacementPolicyForm,
        editTierDataPlacementModal,
        addTierModal,
        /** INJECT:bucket.list **/

        namespaceBucketPanel,
        namespaceBucketSummary,
        namespaceBucketDataPlacementForm,
        namespaceBucketS3AccessForm,
        /** INJECT:namespace-bucket.list **/

        objectPanel,
        objectSummary,
        objectProperties,
        objectPartsList,
        /** INJECT:object.list **/

        resourcesPanel,
        poolsTable,
        cloudResourcesTable,
        namespaceResourcesTable,
        /** INJECT:resources.list **/

        poolPanel,
        poolSummary,
        poolHostsTable,
        /** INJECT:pool.list **/

        cloudResourcePanel,
        cloudResourceSummary,
        cloudResourcePropertiesForm,
        /** INJECT:cloud-resource.list **/

        hostPanel,
        hostSummary,
        hostDetailsForm,
        hostEndpointForm,
        hostStorageForm,
        hostDiagnosticsForm,
        /** INJECT:host.list **/

        managementPanel,
        p2pForm,
        systemAddressForm,
        versionForm,
        diagnosticsForm,
        maintenanceForm,
        proxyServerForm,
        remoteSyslogForm,
        serverSslForm,
        serverTimeForm,
        serverDnsSettingsForm,
        vmToolsForm,
        /** INJECT:management.list **/

        accountsPanel,
        accountsTable,
        /** INJECT:accounts.list **/

        accountPanel,
        accountDetailsForm,
        accountS3AccessForm,
        regenerateAccountCredentialsModal,
        accountConnectionsTable,
        /** INJECT:account.list **/

        clusterPanel,
        serverTable,
        clusterSummary,
        /** INJECT:cluster.list **/

        serverPanel,
        serverSummary,
        serverDetailsForm,
        serverDiagnosticsForm,
        serverCommunicationForm,
        /** INJECT:server.list **/

        funcsPanel,
        funcsTable,
        /** INJECT:funcs.list **/

        funcPanel,
        funcSummary,
        funcConfigForm,
        funcMonitoring,
        funcCodeForm,
        funcMonitoringForm,
        /** INJECT:func.list **/

        analyticsPanel,
        analyticsResourceDistributionForm,
        bucketUsageForm,
        accountUsageForm,
        objectsDistributionForm,
        cloudUsageStatsForm,
        dataBreakdownForm,
        /** INJECT:analytics.list **/

        auditPane,
        alertsPane,
        /** INJECT:admin.list **/

        svgIcon,
        modal,
        dropdown,
        radioBtn,
        radioGroup,
        checkbox,
        bar,
        progressBar,
        rangeIndicator,
        stepper,
        multiselect,
        slider,
        paginator,
        drawer,
        deleteButton,
        fileSelector,
        autocomplete,
        editor,
        toggleSwitch,
        propertySheet,
        capacityBar,
        toggleGroup,
        dataTable,
        timezoneChooser,
        dateTimeChooser,
        pieChart,
        barChart,
        chartLegend,
        copyToClipboardButton,
        passwordField,
        workingButton,
        collapsibleSection,
        chartjs,
        breadcrumbs,
        sideNav,
        tokenField,
        validationMessage,
        validationRulesList,
        validationIndicator,
        loadingIndicator,
        dropArea,
        wizard,
        wizardControls,
        managedForm,
        buttonGroup,
        resourceAssociatedAccountList,
        resourceConnectedBucketsForm,
        resourceDistributionTable,
        resourceDistributionChart,
        hostPartsTable,
        counter,
        listDetails,
        codeViewer,
        resourcesSelectionTable,
        placementPolicyToggle,
        tagList,
        /** INJECT:shared.list **/

        // An empty component used for app/data loading periods
        empty: { template: ' ' }

    }).forEach(pair =>
        ko.components.register(toDashedCase(pair[0]), pair[1])
    );
}
