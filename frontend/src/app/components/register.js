// Register the components with knockout component container.
export default function register(ko) {

    // -------------------------------
    // Empty component
    // -------------------------------
    ko.components.register('empty', { template: ' ' });

    // -------------------------------
    // Layout
    // -------------------------------
    ko.components.register('main-layout',       require('./layout/main-layout/main-layout'));
    ko.components.register('main-header',       require('./layout/main-header/main-header'));
    ko.components.register('commands-bar',      require('./layout/commands-bar/commands-bar'));
    ko.components.register('breadcrumbs',       require('./layout/breadcrumbs/breadcrumbs'));
    ko.components.register('notification-box',  require('./layout/notification-box/notification-box'));
    ko.components.register('welcome-modal',     require('./layout/welcome-modal/welcome-modal'));
    ko.components.register('upgraded-capacity-notification-modal', require('./layout/upgraded-capacity-notification-modal/upgraded-capacity-notification-modal'));
    ko.components.register('debug-mode-sticky',     require('./layout/debug-mode-sticky/debug-mode-sticky'));
    ko.components.register('maintenance-sticky',    require('./layout/maintenance-sticky/maintenance-sticky'));
    ko.components.register('license-sticky',        require('./layout/license-sticky/license-sticky'));
    /** INJECT:layout **/

    // -------------------------------
    // Login
    // -------------------------------
    ko.components.register('login-layout',          require('./login/login-layout/login-layout'));
    ko.components.register('signin-form',           require('./login/signin-form/signin-form'));
    ko.components.register('create-system-form',    require('./login/create-system-form/create-system-form'));
    /** INJECT:login **/

    // -------------------------------
    // Overview
    // -------------------------------
    ko.components.register('overview-panel',        require('./overview/overview-panel/overview-panel'));
    ko.components.register('pools-overview',        require('./overview/pools-overview/pools-overview'));
    ko.components.register('buckets-overview',      require('./overview/buckets-overview/buckets-overview'));
    ko.components.register('install-node-wizard',   require('./overview/install-node-wizard/install-node-wizard'));
    ko.components.register('connect-app-wizard',    require('./overview/connect-app-wizard/connect-app-wizard'));
    ko.components.register('after-upgrade-modal',   require('./overview/after-upgrade-modal/after-upgrade-modal'));
    /** INJECT:overview **/

    // -------------------------------
    // Buckets
    // -------------------------------
    ko.components.register('buckets-panel',         require('./buckets/buckets-panel/buckets-panel'));
    ko.components.register('buckets-table',         require('./buckets/buckets-table/buckets-table'));
    ko.components.register('create-bucket-wizard',  require('./buckets/create-bucket-wizard/create-bucket-wizard'));
    /** INJECT:buckets **/

    // -------------------------------
    // Bucket
    // -------------------------------
    ko.components.register('bucket-panel',                          require('./bucket/bucket-panel/bucket-panel'));
    ko.components.register('bucket-summary',                        require('./bucket/bucket-summary/bucket-summary'));
    ko.components.register('bucket-objects-table',                  require('./bucket/bucket-objects-table/bucket-objects-table'));
    ko.components.register('bucket-data-placement-form',            require('./bucket/bucket-data-placement-form/bucket-data-placement-form'));
    ko.components.register('bucket-cloud-sync-form',                require('./bucket/bucket-cloud-sync-form/bucket-cloud-sync-form'));
    ko.components.register('bucket-placement-policy-modal',         require('./bucket/bucket-placement-policy-modal/bucket-placement-policy-modal'));
    ko.components.register('upload-files-modal',                    require('./bucket/upload-files-modal/upload-files-modal'));
    ko.components.register('set-cloud-sync-modal',                  require('./bucket/set-cloud-sync-modal/set-cloud-sync-modal'));
    ko.components.register('edit-cloud-sync-modal',                 require('./bucket/edit-cloud-sync-modal/edit-cloud-sync-modal'));
    ko.components.register('bucket-s3-access-list',                 require('./bucket/bucket-s3-access-list/bucket-s3-access-list'));
    ko.components.register('s3-access-details-modal',               require('./bucket/s3-access-details-modal/s3-access-details-modal'));
    ko.components.register('bucket-s3-access-modal',                require('./bucket/bucket-s3-access-modal/bucket-s3-access-modal'));
    ko.components.register('bucket-backup-policy-modal',            require('./bucket/bucket-backup-policy-modal/bucket-backup-policy-modal'));
    /** INJECT:bucket **/

    // -------------------------------
    // Object
    // -------------------------------
    ko.components.register('object-panel',          require('./object/object-panel/object-panel'));
    ko.components.register('object-summary',        require('./object/object-summary/object-summary'));
    ko.components.register('object-parts-list',     require('./object/object-parts-list/object-parts-list'));
    ko.components.register('object-preview-modal',  require('./object/object-preview-modal/object-preview-modal'));
    /** INJECT:object **/

    // -------------------------------
    // resources
    // -------------------------------
    ko.components.register('resources-panel',           require('./resources/resources-panel/resources-panel'));
    ko.components.register('pools-table',               require('./resources/pools-table/pools-table'));
    ko.components.register('create-pool-wizard',        require('./resources/create-pool-wizard/create-pool-wizard'));
    ko.components.register('cloud-resources-table',     require('./resources/cloud-resources-table/cloud-resources-table'));
    ko.components.register('add-cloud-resource-modal',  require('./resources/add-cloud-resource-modal/add-cloud-resource-modal'));
    /** INJECT:resources **/

    // -------------------------------
    // Pool
    // -------------------------------
    ko.components.register('pool-panel',            require('./pool/pool-panel/pool-panel'));
    ko.components.register('pool-summary',          require('./pool/pool-summary/pool-summary'));
    ko.components.register('pool-nodes-table',      require('./pool/pool-nodes-table/pool-nodes-table'));
    ko.components.register('assign-nodes-modal',    require('./pool/assign-nodes-modal/assign-nodes-modal'));
    /** INJECT:pool **/

    // -------------------------------
    // Node
    // -------------------------------
    ko.components.register('node-panel',            require('./node/node-panel/node-panel'));
    ko.components.register('node-summary',          require('./node/node-summary/node-summary'));
    ko.components.register('node-parts-table',      require('./node/node-parts-table/node-parts-table'));
    ko.components.register('node-details-form',     require('./node/node-details-form/node-details-form'));
    ko.components.register('node-diagnostics-form', require('./node/node-diagnostics-form/node-diagnostics-form'));
    ko.components.register('test-node-modal',       require('./node/test-node-modal/test-node-modal'));
    /** INJECT:node **/

    // -------------------------------
    // Management
    // -------------------------------
    ko.components.register('management-panel',          require('./management/management-panel/management-panel'));
    ko.components.register('accounts-table',            require('./management/accounts-table/accounts-table'));
    ko.components.register('reset-password-modal',      require('./management/reset-password-modal/reset-password-modal'));
    ko.components.register('create-account-wizard',     require('./management/create-account-wizard/create-account-wizard'));
    ko.components.register('account-s3-access-modal',   require('./management/account-s3-access-modal/account-s3-access-modal'));
    ko.components.register('p2p-form',                  require('./management/p2p-form/p2p-form'));
    ko.components.register('server-dns-form',           require('./management/server-dns-form/server-dns-form'));
    ko.components.register('version-form',              require('./management/version-form/version-form'));
    ko.components.register('upgrade-modal',             require('./management/upgrade-modal/upgrade-modal'));
    ko.components.register('diagnostics-form',          require('./management/diagnostics-form/diagnostics-form'));
    ko.components.register('maintenance-form',          require('./management/maintenance-form/maintenance-form'));
    ko.components.register('start-maintenance-modal',   require('./management/start-maintenance-modal/start-maintenance-modal'));
    ko.components.register('phone-home-form',           require('./management/phone-home-form/phone-home-form'));
    ko.components.register('remote-syslog-form',        require('./management/remote-syslog-form/remote-syslog-form'));
    ko.components.register('server-ssl-form',           require('./management/server-ssl-form/server-ssl-form'));
    ko.components.register('server-time-form',          require('./management/server-time-form/server-time-form'));
    ko.components.register('server-dns-settings-form',  require('./management/server-dns-settings-form/server-dns-settings-form'));
    /** INJECT:management **/

    // -------------------------------
    // Cluster
    // -------------------------------
    ko.components.register('cluster-panel',                 require('./cluster/cluster-panel/cluster-panel'));
    ko.components.register('server-table',                  require('./cluster/server-table/server-table'));
    ko.components.register('attach-server-modal',           require('./cluster/attach-server-modal/attach-server-modal'));
    ko.components.register('cluster-summary',               require('./cluster/cluster-summary/cluster-summary'));
    ko.components.register('server-dns-settings-modal',     require('./cluster/server-dns-settings-modal/server-dns-settings-modal'));
    ko.components.register('server-time-settings-modal',    require('./cluster/server-time-settings-modal/server-time-settings-modal'));
    /** INJECT:cluster **/

    // -------------------------------
    // Admin
    // -------------------------------
    ko.components.register('audit-pane',         require('./admin/audit-pane/audit-pane'));
    /** INJECT:admin **/

    // -------------------------------
    // shared
    // -------------------------------
    ko.components.register('svg-icon',                  require('./shared/svg-icon/svg-icon'));
    ko.components.register('modal',                     require('./shared/modal/modal'));
    ko.components.register('dropdown',                  require('./shared/dropdown/dropdown'));
    ko.components.register('radio-btn',                 require('./shared/radio-btn/radio-btn'));
    ko.components.register('radio-group',               require('./shared/radio-group/radio-group'));
    ko.components.register('checkbox',                  require('./shared/checkbox/checkbox'));
    ko.components.register('quantity-gauge',            require('./shared/quantity-gauge/quantity-gauge'));
    ko.components.register('needle-gauge',              require('./shared/needle-gauge/needle-gauge'));
    ko.components.register('bar',                       require('./shared/bar/bar'));
    ko.components.register('progress-bar',              require('./shared/progress-bar/progress-bar'));
    ko.components.register('range-indicator',           require('./shared/range-indicator/range-indicator'));
    ko.components.register('stepper',                   require('./shared/stepper/stepper'));
    ko.components.register('multiselect',               require('./shared/multiselect/multiselect'));
    ko.components.register('slider',                    require('./shared/slider/slider'));
    ko.components.register('wizard',                    require('./shared/wizard/wizard'));
    ko.components.register('paginator',                 require('./shared/paginator/paginator'));
    ko.components.register('drawer',                    require('./shared/drawer/drawer'));
    ko.components.register('delete-button',             require('./shared/delete-button/delete-button'));
    ko.components.register('file-selector',             require('./shared/file-selector/file-selector'));
    ko.components.register('autocomplete',              require('./shared/autocomplete/autocomplete'));
    ko.components.register('editor',                    require('./shared/editor/editor'));
    ko.components.register('toggle-switch',             require('./shared/toggle-switch/toggle-switch'));
    ko.components.register('property-sheet',            require('./shared/property-sheet/property-sheet'));
    ko.components.register('capacity-bar',              require('./shared/capacity-bar/capacity-bar'));
    ko.components.register('add-s3-connection-modal',   require('./shared/add-s3-connection-modal/add-s3-connection-modal'));
    ko.components.register('toggle-filter',             require('./shared/toggle-filter/toggle-filter'));
    ko.components.register('data-table',                require('./shared/data-table/data-table'));
    ko.components.register('timezone-chooser',          require('./shared/timezone-chooser/timezone-chooser'));
    ko.components.register('date-time-chooser',         require('./shared/date-time-chooser/date-time-chooser'));
    ko.components.register('pie-chart',                 require('./shared/pie-chart/pie-chart'));
    ko.components.register('bar-chart',                 require('./shared/bar-chart/bar-chart'));
    ko.components.register('pool-selection-table',      require('./shared/pool-selection-table/pool-selection-table'));
    ko.components.register('node-selection-table',      require('./shared/node-selection-table/node-selection-table'));
    ko.components.register('chart-legend', require('./shared/chart-legend/chart-legend'));
    /** INJECT:shared **/
}
