/* Copyright (C) 2016 NooBaa */

export default {
    node: {
        displayName: 'Nodes',
        events: {
            create: {
                message: 'Node Added',
                entityId: ({ node }) => node && node.name
            },

            test_node: {
                message: 'Node Tested',
                entityId: ({ node }) => node && node.name
            },

            decommission: {
                message: 'Node Deactivated',
                entityId: ({ node }) => node && node.name
            },

            storage_disabled: {
                message: 'Node Storage Disabled',
                entityId: ({ node }) => node && node.name
            },

            storage_enabled: {
                message: 'Node Storage Enabled',
                entityId: ({ node }) => node && node.name
            },

            edit_drives: {
                message: 'Node Storage Drives Edited',
                entityId: ({ node }) => node && node.name
            },

            endpoint_disabled: {
                message: 'Node S3 Endpoint Disabled',
                entityId: ({ node }) => node && node.name
            },

            endpoint_enabled: {
                message: 'Node S3 Endpoint Enabled',
                entityId: ({ node }) => node && node.name
            },

            recommission: {
                message: 'Node Reactivated',
                entityId: ({ node }) => node && node.name
            },

            connected: {
                message: 'Drive Connected',
                entityId: ({ node }) => node && node.name
            },

            deleted: {
                message: 'Node Deleted',
                entityId: ({ node }) => node && node.name
            },

            delete_started: {
                message: 'Node Deletion Started',
                entityId: ({ node }) => node && node.name
            },

            untrusted: {
                message: 'Node Untrusted',
                entityId: ({ node }) => node && node.name
            },

            retrust: {
                message: 'Node Retrusted',
                entityId: ({ node }) => node && node.name
            },

            disconnected: {
                message: 'Drive Disconnected',
                entityId: ({ node }) => node && node.name
            }
        }
    },

    obj: {
        displayName: 'Objects',
        events: {
            uploaded: {
                message: 'Upload Completed',
                entityId: ({ obj }) => obj && obj.key
            },
            deleted: {
                message: 'Object Deleted',
                entityId: ({ obj }) => obj && obj.key
            }
        }
    },

    bucket: {
        displayName: 'Buckets',
        events: {
            create: {
                message: 'Bucket Created',
                entityId: ({ bucket }) => bucket && bucket.name
            },

            delete: {
                message: 'Bucket Deleted',
                entityId: ({ bucket }) => bucket && bucket.name
            },

            set_cloud_sync: {
                message: 'Bucket Cloud Sync Set',
                entityId: ({ bucket }) => bucket && bucket.name
            },

            update_cloud_sync: {
                message: 'Bucket Cloud Sync Updated',
                entityId: ({ bucket }) => bucket && bucket.name
            },

            remove_cloud_sync: {
                message: 'Bucket Cloud Sync Removed',
                entityId: ({ bucket }) => bucket && bucket.name
            },

            edit_policy: {
                message: 'Edit Bucket Policy',
                entityId: ({ bucket }) => bucket && bucket.name
            },

            edit_resiliency: {
                message: 'Edit Bucket Data Resiliency',
                entityId: ({ bucket }) => bucket && bucket.name
            },

            s3_access_updated: {
                message: 'Bucket S3 Access Updated',
                entityId: ({ bucket }) => bucket && bucket.name
            },

            set_lifecycle_configuration_rules: {
                message: 'Set Lifecycle Configuration',
                entityId: ({ bucket }) => bucket && bucket.name
            },

            quota: {
                message: 'Bucket Quota Configuration',
                entityId: ({ bucket }) => bucket && bucket.name
            },

            versioning: {
                message: 'Bucket Versioning Updated',
                entityId: ({ bucket }) => bucket && bucket.name
            },

            delete_lifecycle_configuration_rules: {
                message: 'Delete Lifecycle Configuration',
                entityId: ({ bucket }) => bucket && bucket.name
            }
        }
    },

    account: {
        displayName: 'Accounts',
        events: {
            create: {
                message: 'Account Created',
                entityId: ({ account }) => account && account.email
            },

            update: {
                message: 'Account Updated',
                entityId: ({ account }) => account && account.email
            },

            delete: {
                message: 'Account Deleted',
                entityId: ({ account }) => account && account.email
            },

            s3_access_updated: {
                message: 'Account S3 Access Updated',
                entityId: ({ account }) => account && account.email
            },

            generate_credentials: {
                message: 'Account Credentials Generated',
                entityId: ({ account }) => account && account.email
            },
            connection_create: {
                message: 'Connection Created',
                entityId: ({ account }) => account && account.email
            },
            connection_delete: {
                message: 'Connection Deleted',
                entityId: ({ account }) => account && account.email
            }
        }
    },

    resource: {
        displayName: 'Resources',
        events: {
            create: {
                message: 'Pool Created',
                entityId: ({ pool }) => pool && pool.name
            },

            delete: {
                message: 'Pool Deleted',
                entityId: ({ pool }) => pool && pool.name
            },

            cloud_create: {
                message: 'Cloud Resource Created',
                entityId: ({ pool }) => pool && pool.name
            },

            cloud_delete: {
                message: 'Cloud Resource Deleted',
                entityId: ({ pool }) => pool && pool.name
            },

            assign_nodes: {
                message: 'Pool Nodes Assigned',
                entityId: ({ pool }) => pool && pool.name
            },

            pool_assign_region: {
                message: 'Pool Region Assigned',
                entityId: ({ pool }) => pool && pool.name
            },

            cloud_assign_region: {
                message: 'Cloud Resource Region Assigned',
                entityId: ({ pool }) => pool && pool.name
            }
        }
    },

    dbg: {
        displayName: 'Debug',
        events: {
            set_debug_node: {
                message: 'Node\'s Debug Mode Change',
                entityId: ({ node }) => node && node.name
            },

            diagnose_system: {
                message: 'System Diagnose',
                entityId: () => ''
            },

            diagnose_server: {
                message: 'Server Diagnostics Collected',
                entityId: ({ server = {} }) => {
                    const { hostname, secret } = server;
                    return (hostname && secret) ? `${hostname}-${secret}` : '';
                }
            },

            set_debug_level: {
                message: 'System Debug Mode Changed',
                entityId: () => ''
            },

            set_server_debug_level: {
                message: 'Server Debug Mode Changed',
                entityId: ({ server = {} }) => {
                    const { hostname, secret } = server;
                    return (hostname && secret) ? `${hostname}-${secret}` : '';
                }
            },

            maintenance_mode: {
                message: 'Maintenance Mode Started',
                entityId: () => ''
            },

            maintenance_mode_stopped: {
                message: 'Maintenance Mode Stopped',
                entityId: () => ''
            }
        }
    },

    cluster: {
        displayName: 'Cluster',
        events: {
            added_member_to_cluster: {
                message: 'Server Added To Cluster',
                entityId: ({ server = {} }) => {
                    const { hostname, secret } = server;
                    return (hostname && secret) ? `${hostname}-${secret}` : '';
                }
            },

            set_server_conf: {
                message: 'Server Configuration Set',
                entityId: ({ server = {} }) => {
                    const { hostname, secret } = server;
                    return (hostname && secret) ? `${hostname}-${secret}` : '';
                }
            }
        }
    },

    conf: {
        displayName: 'Configuration',
        events: {
            create_system: {
                message: 'System Created',
                entityId: () => ''
            },

            server_date_time_updated: {
                message: 'Server Date And Time Updated',
                entityId: () => ''
            },

            dns_address: {
                message: 'DNS Address Set',
                entityId: () => ''
            },

            set_phone_home_proxy_address: {
                message: 'Proxy Address Set',
                entityId: () => ''
            },

            dns_servers: {
                message: 'DNS Servers Set',
                entityId: () => ''
            },

            remote_syslog: {
                message: 'Remote Syslog Set',
                entityId: () => ''
            },

            set_certificate: {
                message: 'Certificate Set',
                entityId: () => ''
            },

            vmtools_install: {
                message: 'VMware tools installed',
                entityId: () => ''
            },

            upload_package: {
                message: 'Upgrade package upload started',
                entityId: () => ''
            },

            system_upgrade_started: {
                message: 'System upgrade started ',
                entityId: () => ''
            },

            system_after_completed: {
                message: 'System upgrade completed',
                entityId: () => ''
            }
        }
    }
};
