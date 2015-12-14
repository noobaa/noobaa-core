import ko from 'knockout';
import numeral from 'numeral';
import { formatSize, isDefined } from 'utils';
import { deleteBucket } from'actions';

const stateIconMapping = Object.freeze({
	true: '/assets/icons.svg#bucket-healthy',
	false: '/assets/icons.svg#bucket-problam'
});

const cloudSyncStatusMapping = Object.freeze({
	[undefined]:	{ label: 'N/A', 			css: '' 				},
	NOTSET: 		{ label: 'not set',  		css: 'no-set'			},
	UNSYNCED: 		{ label: 'unsynced', 		css: 'unsynced'			},
	SYNCING: 		{ label: 'syncing',  		css: 'syncing'			},
	PASUED: 		{ label: 'paused',			css: 'paused'			},
	SYNCED: 		{ label: 'synced', 			css: 'synced'			},
	UNABLE: 		{ label: 'unable to sync', 	css: 'unable-to-sync'	}
});

export default class BucketRowViewModel {
	constructor(bucket, deleteCandidate) {
		this.isVisible = ko.pureComputed( 
			() => !!bucket()
		);

		this.isDisabled = ko.pureComputed(
			() => isDefined(bucket().placeholder)
		);

		this.stateIcon = ko.pureComputed(
			() => stateIconMapping[bucket().state || true]
		);

		this.name = ko.pureComputed(
			() => bucket().name
		);

		this.href = ko.pureComputed(
			() => this.isDisabled() ? '' : `/systems/:system/buckets/${bucket().name}`
		);

		this.fileCount = ko.pureComputed(
			() => {
				let count = bucket().num_objects;
				return isDefined(count) ? numeral(count).format('0,0') : 'N/A';
			}
		);

		this.totalSize = ko.pureComputed(
			() => {
				let storage = bucket().storage;
				return isDefined(storage) ? formatSize(storage.total) : 'N/A';
			}
		);

		this.freeSize = ko.pureComputed(
			() => {
				let storage = bucket().storage;
				return isDefined(storage) ? formatSize(storage.free) : 'N/A';
			}
		);

		this.cloudSyncStatus = ko.pureComputed(
			() => cloudSyncStatusMapping[bucket().cloud_sync_status]
		);

		this.allowDelete = ko.pureComputed(
			() => !this.isDisabled() && bucket().num_objects === 0
		);

		this.isDeleteCandidate = ko.pureComputed({
			read: () => deleteCandidate() === this,
			write: value => value ? deleteCandidate(this) : deleteCandidate(null)
		});

		this.deleteIcon = ko.pureComputed(
			() => `/assets/icons.svg#${
				this.allowDelete() ? 
					(this.isDeleteCandidate() ? 'trash-opened' : 'trash-closed') : 
					'no-entry'
			}`
		);

		this.deleteTooltip = ko.pureComputed( 
			() => this.allowDelete() ? 'delete bucket' : 'bucket is not empty'
		);
	}

	delete() {
		deleteBucket(this.name());
		this.isDeleteCandidate(false);
	}
}