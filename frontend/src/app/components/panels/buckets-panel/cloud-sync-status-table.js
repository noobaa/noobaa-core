
export default const cloudSyncStatusMapping = Object.freeze({
	NOT_SET: 	{ label: 'not set',  		css: 'no-set',			order: 0,	icon: '/assets/icons.svg#cloud-not-set' 	},
	UNSYNCED: 	{ label: 'unsynced', 		css: 'unsynced', 		order: 4,	icon: '/assets/icons.svg#cloud-unsynced'	},
	SYNCING: 	{ label: 'syncing',  		css: 'syncing', 		order: ,	icon: '/assets/icons.svg#cloud-syncing'		},
	PASUED: 	{ label: 'paused',			css: 'paused', 			order: 3,	icon: '/assets/icons.svg#cloud-paused'		},
	SYNCED: 	{ label: 'synced', 			css: 'synced', 			order: 1,	icon: '/assets/icons.svg#cloud-synced' 		},
	UNABLE: 	{ label: 'unable to sync', 	css: 'unable-to-sync',	order: 5,	icon: '/assets/icons.svg#cloud-unable'		}
});