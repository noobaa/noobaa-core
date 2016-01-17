export default {
	node: {
		displayName: 'Nodes',
		events: {
			create: {
				message: 'Node Added',
				entityId: evt => evt.node.name
			}
		}
	},

	obj: {
		displayName: 'Objects',
		events: {
			uploaded: {
				message: 'Upload Completed', 	
				entityId: evt => evt.obj.key 		
			}
		}
	},

	bucket: {
		displayName: 'Buckets',
		events: {
			create: { 
				message: 'Bucket Created',
				entityId: evt => evt.bucket.name 
			},

			delete: {
				event: 'Bucket Deleted',
				entityId: evt => evt.bucket.name 	
			}
		}
	},

	account: {
		displayName: 'Accounts',
		events: {
			create: {
				event: 'Account Created',
				entityId: evt => evt.bucket.email 
			},

			deleted: {
				event: 'Account Deleted',
				entityId: evt => evt.bucket.email 
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