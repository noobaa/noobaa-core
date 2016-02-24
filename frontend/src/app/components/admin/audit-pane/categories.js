export default {
    node: {
        displayName: 'Nodes',
        events: {
            create: {
                message: 'Node Added',
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
            }
        }
    },

    pool: {
        displayName: 'Pools',
        events: {
        }
    },

    conf: {
        displayName: 'Configuration',
        events: {
        }
    },

    dbg: {
        displayName: 'Debug',
        events: {
        }
    }
};