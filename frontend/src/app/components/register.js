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
import changePasswordForm from './login/change-password-form/change-password-form';
import splashScreen from './login/splash-screen/splash-screen';
import oauthCallback from './login/oauth-callback/oauth-callback';
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
/** INJECT:stickies.import **/

// -------------------------------
// Modal components
// -------------------------------
import welcomeModal from './modals/welcome-modal/welcome-modal';
import addCloudResourceModal from './modals/add-cloud-resource-modal/add-cloud-resource-modal';
import addCloudConnectionModal from './modals/add-cloud-connection-modal/add-cloud-connection-modal';
import s3AccessDetailsModal from './modals/s3-access-details-modal/s3-access-details-modal';
import editBucketS3AccessModal from './modals/edit-bucket-s3-access-modal/edit-bucket-s3-access-modal';
import startMaintenanceModal from './modals/start-maintenance-modal/start-maintenance-modal';
import fileUploadsModal from './modals/file-uploads-modal/file-uploads-modal';
import deleteCurrentAccountWarningModal from './modals/delete-current-account-warning-modal/delete-current-account-warning-modal';
import objectPreviewModal from './modals/object-preview-modal/object-preview-modal';
import testNodeModal from './modals/test-node-modal/test-node-modal';
import editAccountS3AccessModal from './modals/edit-account-s3-access-modal/edit-account-s3-access-modal';
import editServerDetailsModal from './modals/edit-server-details-modal/edit-server-details-modal';
import createAccountModal from './modals/create-account-modal/create-account-modal';
import accountCreatedModal from './modals/account-created-modal/account-created-modal';
import editBucketQuotaModal from './modals/edit-bucket-quota-modal/edit-bucket-quota-modal';
import setAccountIpRestrictionsModal from './modals/set-account-ip-restrictions-modal/set-account-ip-restrictions-modal';
import connectAppModal from './modals/connect-app-modal/connect-app-modal';
import createNamespaceResourceModal from './modals/create-namespace-resource-modal/create-namespace-resource-modal';
import createNamespaceBucketModal from './modals/create-namespace-bucket-modal/create-namespace-bucket-modal';
import editNamespaceBucketDataPlacementModal from './modals/edit-namespace-bucket-data-placement-modal/edit-namespace-bucket-data-placement-modal';
import emptyDataPlacementWarningModal from './modals/empty-data-placement-warning-modal/empty-data-placement-warning-modal';
import setNodeAsTrustedModal from './modals/set-node-as-trusted-modal/set-node-as-trusted-modal';
import editBucketDataResiliencyModal from './modals/edit-bucket-data-resiliency-modal/edit-bucket-data-resiliency-modal';
import riskyBucketDataResiliencyWarningModal from './modals/risky-bucket-data-resiliency-warning-modal/risky-bucket-data-resiliency-warning-modal';
import changeClusterConnectivityIpModal from './modals/change-cluster-connectivity-ip-modal/change-cluster-connectivity-ip-modal';
import managementConsoleErrorModal from './modals/management-console-error-modal/management-console-error-modal';
import addBucketTriggerModal from './modals/add-bucket-trigger-modal/add-bucket-trigger-modal';
import editBucketTriggerModal from './modals/edit-bucket-trigger-modal/edit-bucket-trigger-modal';
import attachServerModal from './modals/attach-server-modal/attach-server-modal';
import createFuncModal from './modals/create-func-modal/create-func-modal';
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
import addResourcesModal from './modals/add-resources-modal/add-resources-modal';
import regenerateAccountCredentialsModal from './modals/regenerate-account-credentials-modal/regenerate-account-credentials-modal';
import editTierDataPlacementModal from './modals/edit-tier-data-placement-modal/edit-tier-data-placement-modal';
import addTierModal from './modals/add-tier-modal/add-tier-modal';
import sessionExpiredModal from './modals/session-expired-modal/session-expired-modal';
import deployK8sPoolModal from './modals/deploy-k8s-pool-modal/deploy-k8s-pool-modal';
import editK8sPoolModal from './modals/edit-k8s-pool-modal/edit-k8s-pool-modal';
import deletePoolWithDataWarningModal from './modals/delete-pool-with-data-warning-modal/delete-pool-with-data-warning-modal';
import confirmDangerousScalingModal from './modals/confirm-dangerous-scaling-modal/confirm-dangerous-scaling-modal';
import editCloudConnectionModal from './modals/edit-cloud-connection-modal/edit-cloud-connection-modal';
import cloudConnectionUpdateWarningModal from './modals/cloud-connection-update-warning-modal/cloud-connection-update-warning-modal';
import completeSslCertificateInstallationModal from './modals/complete-ssl-certificate-installation-modal/complete-ssl-certificate-installation-modal';
import deployRemoteEndpointGroupModal from './modals/deploy-remote-endpoint-group-modal/deploy-remote-endpoint-group-modal';
import editEndpointGroupModal from './modals/edit-endpoint-group-modal/edit-endpoint-group-modal';
import oauthAccessDeniedModal from './modals/oauth-access-denied-modal/oauth-access-denied-modal';
import oauthUnauthorizedModal from './modals/oauth-unauthorized-modal/oauth-unauthorized-modal';
/** INJECT:modals.import **/

// -------------------------------
// Overview page components
// -------------------------------
import overviewPanel from './overview/overview-panel/overview-panel';
import bucketsOverview from './overview/buckets-overview/buckets-overview';
import resourceOverview from './overview/resource-overview/resource-overview';
import storageOverview from './overview/storage-overview/storage-overview';
import clusterOverview from './overview/cluster-overview/cluster-overview';
import alertsOverview from './overview/alerts-overview/alerts-overview';
/** INJECT:overview.import **/

// -------------------------------
// Buckets page components
// -------------------------------
import bucketsPanel from './buckets/buckets-panel/buckets-panel';
import bucketsTable from './buckets/buckets-table/buckets-table';
import namespaceBucketsTable from './buckets/namespace-buckets-table/namespace-buckets-table';
import bucketsSummary from './buckets/buckets-summary/buckets-summary';
/** INJECT:bucket.import **/

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
/** INJECT:bucket.import **/

// -------------------------------
// Namespace bucket page components
// -------------------------------
import namespaceBucketPanel from './namespace-bucket/namespace-bucket-panel/namespace-bucket-panel';
import namespaceBucketSummary from './namespace-bucket/namespace-bucket-summary/namespace-bucket-summary';
import namespaceBucketDataPlacementForm from './namespace-bucket/namespace-bucket-data-placement-form/namespace-bucket-data-placement-form';
import namespaceBucketS3AccessForm from './namespace-bucket/namespace-bucket-s3-access-form/namespace-bucket-s3-access-form';
import namespaceBucketTriggersForm from './namespace-bucket/namespace-bucket-triggers-form/namespace-bucket-triggers-form';
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
import resourcesSummary from './resources/resources-summary/resources-summary';
import storageResourcesTable from './resources/storage-resources-table/storage-resources-table';
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
import hostDiagnosticsForm from './host/host-diagnostics-form/host-diagnostics-form';
/** INJECT:host.import **/

// -------------------------------
// Management page components
// -------------------------------
import managementPanel from './management/management-panel/management-panel';
import p2pForm from './management/p2p-form/p2p-form';
import versionForm from './management/version-form/version-form';
import diagnosticsForm from './management/diagnostics-form/diagnostics-form';
import maintenanceForm from './management/maintenance-form/maintenance-form';
import sslCertificateForm from './management/ssl-certificate-form/ssl-certificate-form';
import virtualHostingForm from './management/virtual-hosting-form/virtual-hosting-form';
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
import accountConnectionsList from './account/account-connections-list/account-connections-list';
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
// import serverPanel from './server/server-panel/server-panel';
// import serverSummary from './server/server-summary/server-summary';
// import serverMonitoringForm from './server/server-monitoring-form/server-monitoring-form';
// import serverDiagnosticsForm from './server/server-diagnostics-form/server-diagnostics-form';
// import serverCommunicationForm from './server/server-communication-form/server-communication-form';
// import serverDetailsForm from './server/server-details-form/server-details-form';
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
import funcCodeForm from './func/func-code-form/func-code-form';
import funcMonitoringForm from './func/func-monitoring-form/func-monitoring-form';
import funcTriggersForm from './func/func-triggers-form/func-triggers-form';
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
// Analytics page components
// -------------------------------
import endpointsPanel from './endpoints/endpoints-panel/endpoints-panel';
import endpointsSummary from './endpoints/endpoints-summary/endpoints-summary';
import endpointGroupsTable from './endpoints/endpoint-groups-table/endpoint-groups-table';
import endpointGroupsScalingForm from './endpoints/endpoint-groups-scaling-form/endpoint-groups-scaling-form';
/** INJECT:endpoints.import **/

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
import dropdown from './shared/dropdown/dropdown';
import radioBtn from './shared/radio-btn/radio-btn';
import radioGroup from './shared/radio-group/radio-group';
import checkbox from './shared/checkbox/checkbox';
import bar from './shared/bar/bar';
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
import moreInfoIcon from './shared/more-info-icon/more-info-icon';
import progressBar from './shared/progress-bar/progress-bar';
import gaugeChart from './shared/gauge-chart/gauge-chart';
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
        changePasswordForm,
        splashScreen,
        oauthCallback,
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
        /** INJECT:stickies.list **/

        welcomeModal,
        addCloudResourceModal,
        addCloudConnectionModal,
        s3AccessDetailsModal,
        editBucketS3AccessModal,
        startMaintenanceModal,
        fileUploadsModal,
        deleteCurrentAccountWarningModal,
        objectPreviewModal,
        testNodeModal,
        editAccountS3AccessModal,
        editServerDetailsModal,
        createAccountModal,
        accountCreatedModal,
        editBucketQuotaModal,
        setAccountIpRestrictionsModal,
        connectAppModal,
        createNamespaceResourceModal,
        createNamespaceBucketModal,
        editNamespaceBucketDataPlacementModal,
        emptyDataPlacementWarningModal,
        setNodeAsTrustedModal,
        editBucketDataResiliencyModal,
        riskyBucketDataResiliencyWarningModal,
        changeClusterConnectivityIpModal,
        managementConsoleErrorModal,
        addBucketTriggerModal,
        editBucketTriggerModal,
        attachServerModal,
        createFuncModal,
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
        addResourcesModal,
        regenerateAccountCredentialsModal,
        editTierDataPlacementModal,
        addTierModal,
        sessionExpiredModal,
        deployK8sPoolModal,
        editK8sPoolModal,
        deletePoolWithDataWarningModal,
        confirmDangerousScalingModal,
        editCloudConnectionModal,
        cloudConnectionUpdateWarningModal,
        completeSslCertificateInstallationModal,
        deployRemoteEndpointGroupModal,
        editEndpointGroupModal,
        oauthAccessDeniedModal,
        oauthUnauthorizedModal,
        /** INJECT:modals.list **/

        overviewPanel,
        bucketsOverview,
        resourceOverview,
        storageOverview,
        clusterOverview,
        alertsOverview,
        /** INJECT:overview.list **/

        bucketsPanel,
        bucketsTable,
        namespaceBucketsTable,
        bucketsSummary,
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
        /** INJECT:bucket.list **/

        namespaceBucketPanel,
        namespaceBucketSummary,
        namespaceBucketDataPlacementForm,
        namespaceBucketS3AccessForm,
        namespaceBucketTriggersForm,
        /** INJECT:namespace-bucket.list **/

        objectPanel,
        objectSummary,
        objectProperties,
        objectPartsList,
        /** INJECT:object.list **/

        resourcesPanel,
        resourcesSummary,
        storageResourcesTable,
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
        hostDiagnosticsForm,
        /** INJECT:host.list **/

        managementPanel,
        p2pForm,
        versionForm,
        diagnosticsForm,
        maintenanceForm,
        sslCertificateForm,
        virtualHostingForm,
        /** INJECT:management.list **/

        accountsPanel,
        accountsTable,
        /** INJECT:accounts.list **/

        accountPanel,
        accountDetailsForm,
        accountS3AccessForm,
        accountConnectionsList,
        /** INJECT:account.list **/

        clusterPanel,
        serverTable,
        clusterSummary,
        /** INJECT:cluster.list **/

        // serverPanel,
        // serverSummary,
        // serverMonitoringForm,
        // serverDiagnosticsForm,
        // serverCommunicationForm,
        // serverDetailsForm,
        /** INJECT:server.list **/

        funcsPanel,
        funcsTable,
        /** INJECT:funcs.list **/

        funcPanel,
        funcSummary,
        funcConfigForm,
        funcCodeForm,
        funcTriggersForm,
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

        endpointsPanel,
        endpointsSummary,
        endpointGroupsTable,
        endpointGroupsScalingForm,
        /** INJECT:endpoints.list **/


        auditPane,
        alertsPane,
        /** INJECT:admin.list **/

        svgIcon,
        dropdown,
        radioBtn,
        radioGroup,
        checkbox,
        bar,
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
        moreInfoIcon,
        progressBar,
        gaugeChart,
        /** INJECT:shared.list **/

        // An empty component used for app/data loading periods
        empty: { template: ' ' }

    }).forEach(pair =>
        ko.components.register(toDashedCase(pair[0]), pair[1])
    );
}
