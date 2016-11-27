// Register the components with knockout component container.
export default function register(ko) {

    // -------------------------------
    // Empty component
    // -------------------------------
    ko.components.register('empty', { template: ' ' });

    // -------------------------------
    // Layout
    // -------------------------------
    ko.components.register('main-layout',                           require('./layout/main-layout/main-layout').default);
    ko.components.register('main-header',                           require('./layout/main-header/main-header').default);
    ko.components.register('main-nav',                              require('./layout/main-nav/main-nav').default);
    ko.components.register('commands-bar',                          require('./layout/commands-bar/commands-bar').default);
    ko.components.register('breadcrumbs',                           require('./layout/breadcrumbs/breadcrumbs').default);
    ko.components.register('notification-box',                      require('./layout/notification-box/notification-box').default);
    ko.components.register('welcome-modal',                         require('./layout/welcome-modal/welcome-modal').default);
    ko.components.register('upgraded-capacity-notification-modal',  require('./layout/upgraded-capacity-notification-modal/upgraded-capacity-notification-modal').default);
    ko.components.register('debug-mode-sticky',                     require('./layout/debug-mode-sticky/debug-mode-sticky').default);
    ko.components.register('maintenance-sticky',                    require('./layout/maintenance-sticky/maintenance-sticky').default);
    ko.components.register('license-sticky',                        require('./layout/license-sticky/license-sticky').default);
    ko.components.register('phone-home-connectivity-sticky',        require('./layout/phone-home-connectivity-sticky/phone-home-connectivity-sticky').default);
    ko.components.register('file-uploads-modal', require('./layout/file-uploads-modal/file-uploads-modal').default);
    ko.components.register('account-menu', require('./layout/account-menu/account-menu').default);
    /** INJECT:layout **/

    // -------------------------------
    // Login
    // -------------------------------
    ko.components.register('login-layout',              require('./login/login-layout/login-layout').default);
    ko.components.register('signin-form',               require('./login/signin-form/signin-form').default);
    ko.components.register('create-system-form',        require('./login/create-system-form/create-system-form').default);
    ko.components.register('unsupported-form',          require('./login/unsupported-form/unsupported-form').default);
    ko.components.register('unable-to-activate-modal',  require('./login/unable-to-activate-modal/unable-to-activate-modal').default);
    ko.components.register('loading-server-information-from', require('./login/loading-server-information-from/loading-server-information-from').default);
    ko.components.register('change-password-form', require('./login/change-password-form/change-password-form').default);
    /** INJECT:login **/

    // -------------------------------
    // Overview
    // -------------------------------
    ko.components.register('overview-panel',        require('./overview/overview-panel/overview-panel').default);
    ko.components.register('install-node-wizard',   require('./overview/install-node-wizard/install-node-wizard').default);
    ko.components.register('connect-app-wizard',    require('./overview/connect-app-wizard/connect-app-wizard').default);
    ko.components.register('after-upgrade-modal',   require('./overview/after-upgrade-modal/after-upgrade-modal').default);
    /** INJECT:overview **/

    // -------------------------------
    // Buckets
    // -------------------------------
    ko.components.register('buckets-panel',         require('./buckets/buckets-panel/buckets-panel').default);
    ko.components.register('buckets-table',         require('./buckets/buckets-table/buckets-table').default);
    ko.components.register('create-bucket-wizard',  require('./buckets/create-bucket-wizard/create-bucket-wizard').default);
    /** INJECT:buckets **/

    // -------------------------------
    // Bucket
    // -------------------------------
    ko.components.register('bucket-panel',                          require('./bucket/bucket-panel/bucket-panel').default);
    ko.components.register('bucket-summary',                        require('./bucket/bucket-summary/bucket-summary').default);
    ko.components.register('bucket-objects-table',                  require('./bucket/bucket-objects-table/bucket-objects-table').default);
    ko.components.register('bucket-data-placement-form',            require('./bucket/bucket-data-placement-form/bucket-data-placement-form').default);
    ko.components.register('bucket-cloud-sync-form',                require('./bucket/bucket-cloud-sync-form/bucket-cloud-sync-form').default);
    ko.components.register('bucket-placement-policy-modal',         require('./bucket/bucket-placement-policy-modal/bucket-placement-policy-modal').default);
    ko.components.register('set-cloud-sync-modal',                  require('./bucket/set-cloud-sync-modal/set-cloud-sync-modal').default);
    ko.components.register('edit-cloud-sync-modal',                 require('./bucket/edit-cloud-sync-modal/edit-cloud-sync-modal').default);
    ko.components.register('bucket-s3-access-list',                 require('./bucket/bucket-s3-access-list/bucket-s3-access-list').default);
    ko.components.register('s3-access-details-modal',               require('./bucket/s3-access-details-modal/s3-access-details-modal').default);
    ko.components.register('bucket-s3-access-modal',                require('./bucket/bucket-s3-access-modal/bucket-s3-access-modal').default);
    ko.components.register('bucket-backup-policy-modal',            require('./bucket/bucket-backup-policy-modal/bucket-backup-policy-modal').default);
    /** INJECT:bucket **/

    // -------------------------------
    // Object
    // -------------------------------
    ko.components.register('object-panel',          require('./object/object-panel/object-panel').default);
    ko.components.register('object-summary',        require('./object/object-summary/object-summary').default);
    ko.components.register('object-parts-list',     require('./object/object-parts-list/object-parts-list').default);
    ko.components.register('object-preview-modal',  require('./object/object-preview-modal/object-preview-modal').default);
    /** INJECT:object **/

    // -------------------------------
    // resources
    // -------------------------------
    ko.components.register('resources-panel',                   require('./resources/resources-panel/resources-panel').default);
    ko.components.register('pools-table',                       require('./resources/pools-table/pools-table').default);
    ko.components.register('create-pool-wizard',                require('./resources/create-pool-wizard/create-pool-wizard').default);
    ko.components.register('cloud-resources-table',             require('./resources/cloud-resources-table/cloud-resources-table').default);
    ko.components.register('add-cloud-resource-modal',          require('./resources/add-cloud-resource-modal/add-cloud-resource-modal').default);
    /** INJECT:resources **/

    // -------------------------------
    // Pool
    // -------------------------------
    ko.components.register('pool-panel',            require('./pool/pool-panel/pool-panel').default);
    ko.components.register('pool-summary',          require('./pool/pool-summary/pool-summary').default);
    ko.components.register('pool-nodes-table',      require('./pool/pool-nodes-table/pool-nodes-table').default);
    ko.components.register('assign-nodes-modal',    require('./pool/assign-nodes-modal/assign-nodes-modal').default);
    /** INJECT:pool **/

    // -------------------------------
    // Node
    // -------------------------------
    ko.components.register('node-panel',            require('./node/node-panel/node-panel').default);
    ko.components.register('node-summary',          require('./node/node-summary/node-summary').default);
    ko.components.register('node-parts-table',      require('./node/node-parts-table/node-parts-table').default);
    ko.components.register('node-details-form',     require('./node/node-details-form/node-details-form').default);
    ko.components.register('node-diagnostics-form', require('./node/node-diagnostics-form/node-diagnostics-form').default);
    ko.components.register('test-node-modal',       require('./node/test-node-modal/test-node-modal').default);
    /** INJECT:node **/

    // -------------------------------
    // Management
    // -------------------------------
    ko.components.register('management-panel',                  require('./management/management-panel/management-panel').default);
    ko.components.register('accounts-table',                    require('./management/accounts-table/accounts-table').default);
    ko.components.register('reset-password-modal',              require('./management/reset-password-modal/reset-password-modal').default);
    ko.components.register('create-account-wizard',             require('./management/create-account-wizard/create-account-wizard').default);
    ko.components.register('edit-account-s3-access-modal',      require('./management/edit-account-s3-access-modal/edit-account-s3-access-modal').default);
    ko.components.register('p2p-form',                          require('./management/p2p-form/p2p-form').default);
    ko.components.register('server-dns-form',                   require('./management/server-dns-form/server-dns-form').default);
    ko.components.register('version-form',                      require('./management/version-form/version-form').default);
    ko.components.register('upgrade-modal',                     require('./management/upgrade-modal/upgrade-modal').default);
    ko.components.register('diagnostics-form',                  require('./management/diagnostics-form/diagnostics-form').default);
    ko.components.register('maintenance-form'   ,               require('./management/maintenance-form/maintenance-form').default);
    ko.components.register('start-maintenance-modal',           require('./management/start-maintenance-modal/start-maintenance-modal').default);
    ko.components.register('phone-home-form',                   require('./management/phone-home-form/phone-home-form').default);
    ko.components.register('remote-syslog-form',                require('./management/remote-syslog-form/remote-syslog-form').default);
    ko.components.register('server-ssl-form',                   require('./management/server-ssl-form/server-ssl-form').default);
    ko.components.register('server-time-form',                  require('./management/server-time-form/server-time-form').default);
    ko.components.register('server-dns-settings-form',          require('./management/server-dns-settings-form/server-dns-settings-form').default);
    ko.components.register('update-system-name-modal',          require('./management/update-system-name-modal/update-system-name-modal').default);
    ko.components.register('update-server-dns-settings-modal',  require('./management/update-server-dns-settings-modal/update-server-dns-settings-modal').default);
    ko.components.register('account-panel',                     require('./management/account-panel/account-panel').default);
    ko.components.register('account-profile-form',              require('./management/account-profile-form/account-profile-form').default);
    ko.components.register('account-s3-access-form',            require('./management/account-s3-access-form/account-s3-access-form').default);
    /** INJECT:management **/

    // -------------------------------
    // Cluster
    // -------------------------------
    ko.components.register('cluster-panel',                 require('./cluster/cluster-panel/cluster-panel').default);
    ko.components.register('server-table',                  require('./cluster/server-table/server-table').default);
    ko.components.register('attach-server-modal',           require('./cluster/attach-server-modal/attach-server-modal').default);
    ko.components.register('cluster-summary',               require('./cluster/cluster-summary/cluster-summary').default);
    ko.components.register('server-dns-settings-modal',     require('./cluster/server-dns-settings-modal/server-dns-settings-modal').default);
    ko.components.register('server-time-settings-modal',    require('./cluster/server-time-settings-modal/server-time-settings-modal').default);
    /** INJECT:cluster **/

    // -------------------------------
    // Funcs
    // -------------------------------
    ko.components.register('funcs-panel', require('./funcs/funcs-panel/funcs-panel').default);
    ko.components.register('funcs-table', require('./funcs/funcs-table/funcs-table').default);
    /** INJECT:funcs **/

    // -------------------------------
    // Func
    // -------------------------------
    ko.components.register('func-panel', require('./func/func-panel/func-panel').default);
    ko.components.register('func-summary', require('./func/func-summary/func-summary').default);
    ko.components.register('func-code', require('./func/func-code/func-code').default);
    ko.components.register('func-invoke', require('./func/func-invoke/func-invoke').default);
    ko.components.register('func-config', require('./func/func-config/func-config').default);
    ko.components.register('func-triggers', require('./func/func-triggers/func-triggers').default);
    ko.components.register('func-monitoring', require('./func/func-monitoring/func-monitoring').default);
    /** INJECT:func **/

    // -------------------------------
    // Admin
    // -------------------------------
    ko.components.register('audit-pane',         require('./admin/audit-pane/audit-pane').default);
    /** INJECT:admin **/

    // -------------------------------
    // shared
    // -------------------------------
    ko.components.register('svg-icon',                  require('./shared/svg-icon/svg-icon').default);
    ko.components.register('modal',                     require('./shared/modal/modal').default);
    ko.components.register('dropdown',                  require('./shared/dropdown/dropdown').default);
    ko.components.register('radio-btn',                 require('./shared/radio-btn/radio-btn').default);
    ko.components.register('radio-group',               require('./shared/radio-group/radio-group').default);
    ko.components.register('checkbox',                  require('./shared/checkbox/checkbox').default);
    ko.components.register('bar',                       require('./shared/bar/bar').default);
    ko.components.register('progress-bar',              require('./shared/progress-bar/progress-bar').default);
    ko.components.register('range-indicator',           require('./shared/range-indicator/range-indicator').default);
    ko.components.register('stepper',                   require('./shared/stepper/stepper').default);
    ko.components.register('multiselect',               require('./shared/multiselect/multiselect').default);
    ko.components.register('slider',                    require('./shared/slider/slider').default);
    ko.components.register('wizard',                    require('./shared/wizard/wizard').default);
    ko.components.register('paginator',                 require('./shared/paginator/paginator').default);
    ko.components.register('drawer',                    require('./shared/drawer/drawer').default);
    ko.components.register('delete-button',             require('./shared/delete-button/delete-button').default);
    ko.components.register('file-selector',             require('./shared/file-selector/file-selector').default);
    ko.components.register('autocomplete',              require('./shared/autocomplete/autocomplete').default);
    ko.components.register('editor',                    require('./shared/editor/editor').default);
    ko.components.register('toggle-switch',             require('./shared/toggle-switch/toggle-switch').default);
    ko.components.register('property-sheet',            require('./shared/property-sheet/property-sheet').default);
    ko.components.register('capacity-bar',              require('./shared/capacity-bar/capacity-bar').default);
    ko.components.register('add-cloud-connection-modal',require('./shared/add-cloud-connection-modal/add-cloud-connection-modal').default);
    ko.components.register('toggle-filter',             require('./shared/toggle-filter/toggle-filter').default);
    ko.components.register('data-table',                require('./shared/data-table/data-table').default);
    ko.components.register('timezone-chooser',          require('./shared/timezone-chooser/timezone-chooser').default);
    ko.components.register('date-time-chooser',         require('./shared/date-time-chooser/date-time-chooser').default);
    ko.components.register('pie-chart',                 require('./shared/pie-chart/pie-chart').default);
    ko.components.register('bar-chart',                 require('./shared/bar-chart/bar-chart').default);
    ko.components.register('pool-selection-table',      require('./shared/pool-selection-table/pool-selection-table').default);
    ko.components.register('node-selection-table',      require('./shared/node-selection-table/node-selection-table').default);
    ko.components.register('chart-legend',              require('./shared/chart-legend/chart-legend').default);
    ko.components.register('copy-to-clipboard-button',  require('./shared/copy-to-clipboard-button/copy-to-clipboard-button').default);
    ko.components.register('password-field',            require('./shared/password-field/password-field').default);
    ko.components.register('working-button',            require('./shared/working-button/working-button').default);
    ko.components.register('chartjs',                   require('./shared/chartjs/chartjs').default);
    /** INJECT:shared **/
}
