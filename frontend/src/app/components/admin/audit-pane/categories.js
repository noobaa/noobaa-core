export default {
    node: {
        displayName: 'Nodes',
        events: {
            create: {
                message: 'Node Added',
                entityId: ({
                    node
                }) => node && node.name
            },

            test_node: {
                message: 'Node Tested',
                entityId: ({
                    node
                }) => node && node.name
            }
        }
    },

    obj: {
        displayName: 'Objects',
        events: {
            uploaded: {
                message: 'Upload Completed',
                entityId: ({
                    obj
                }) => obj && obj.key
            }
        }
    },

    bucket: {
        displayName: 'Buckets',
        events: {
            create: {
                message: 'Bucket Created',
                entityId: ({
                    bucket
                }) => bucket && bucket.name
            },

            delete: {
                message: 'Bucket Deleted',
                entityId: ({
                    bucket
                }) => bucket && bucket.name
            },

            set_cloud_sync: {
                message: 'Bucket Cloud Sync Set',
                entityId: ({
                    bucket
                }) => bucket && bucket.name
            },

            remove_cloud_sync: {
                message: 'Bucket Cloud Sync Removed',
                entityId: ({
                    bucket
                }) => bucket && bucket.name
            },

            edit_policy: {
                message: 'Bucket Edit Policy',
                entityId: ({
                    bucket
                }) => bucket && bucket.name
            }
        }
    },

    account: {
        displayName: 'Accounts',
        events: {
            create: {
                message: 'Account Created',
                entityId: ({
                    account
                }) => account && account.email
            },

            update: {
                message: 'Account Updated',
                entityId: ({
                    account
                }) => account && account.email
            },

            delete: {
                message: 'Account Deleted',
                entityId: ({
                    account
                }) => account && account.email
            }
        }
    },

    pool: {
        displayName: 'Pools',
        events: {
            create: {
                message: 'Pool Created',
                entityId: ({
                    pool
                }) => pool && pool.name
            },

            delete: {
                message: 'Pool Deleted',
                entityId: ({
                    pool
                }) => pool && pool.name
            },

            assign_nodes: {
                message: 'Pool Nodes Assigned',
                entityId: ({
                    pool
                }) => pool && pool.name
            }
        }
    },

    dbg: {
        displayName: 'Debug',
        events: {
            set_debug_node: {
                message: 'Node Debug Level Changed',
                entityId: ({
                    node
                }) => node && node.name
            }
        }
    },

    conf: {
        displayName: 'Configuration',
        events: {
            create_system: {
                message: 'System Created',
                entityId: ({
                    conf
                }) => {}
            },

            dns_address: {
                message: 'Set/Edit DNS Address',
                entityId: ({
                    conf
                }) => {}
            },

            diagnose_system: {
                message: 'System Diagnose',
                entityId: ({
                    conf
                }) => {}
            }
        }
    }
};
