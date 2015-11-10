import ko from 'knockout';
import numeral from 'numeral';
import { formatSize } from 'utils';

const stateIconMapping = Object.freeze({
	true: '/assets/icons.svg#bucket-healthy',
	false: '/assets/icons.svg#bucket-problam'
});

const cloudSyncStatusMapping = Object.freeze({
	NOT_SET: 	{ label: 'not set',  		css: 'no-set',			icon: '/assets/icons.svg#cloud-not-set' 	},
	UNSYNCED: 	{ label: 'unsynced', 		css: 'unsynced', 		icon: '/assets/icons.svg#cloud-unsynced'	},
	SYNCING: 	{ label: 'syncing',  		css: 'syncing', 		icon: '/assets/icons.svg#cloud-syncing'		},
	PASUED: 	{ label: 'paused',			css: 'paused', 			icon: '/assets/icons.svg#cloud-paused'		},
	SYNCED: 	{ label: 'synced', 			css: 'synced', 			icon: '/assets/icons.svg#cloud-synced' 		},
	UNABLE: 	{ label: 'unable to sync', 	css: 'unable-to-sync',	icon: '/assets/icons.svg#cloud-unable'		}
});

export default class BucketRowViewModel {
	constructor(bucket) {
		this.stateIcon = stateIconMapping[bucket.state];
		this.name = bucket.name;
		this.href = `./buckets/${bucket.name}`;
		this.fileCount = numeral(bucket.num_objects).format('0,0');
		this.totalSize = formatSize(bucket.storage.total);
		this.freeSize = formatSize(bucket.storage.free);
		this.cloudSyncStatus = cloudSyncStatusMapping[bucket.cloud_sync_status];
	}
}