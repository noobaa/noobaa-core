import template from './bucket-summary.html';
import ko from 'knockout';
import numeral from 'numeral';
import style from 'style';
import { formatSize } from 'utils';

class BucketSummrayViewModel {
    constructor({ bucket }) {
        this.dataReady = ko.pureComputed(
            () => !!bucket()
        );

<<<<<<< HEAD
        this.name  = ko.pureComputed(
            () => bucket().name
        );

        this.fileCount = ko.pureComputed(
            () => bucket().num_objects
        );

        this.fileCountText = ko.pureComputed(
            () => `${this.fileCount() ? numeral(this.fileCount()).format('0,0') : 'No'} files`
        )        
        
        this.total = ko.pureComputed(
            () => bucket().storage.used
        );

        this.totalText = ko.pureComputed(
            () => formatSize(bucket().storage.total)
        );

        this.free = ko.pureComputed(
            () => bucket().storage.free
        );
=======
		this.name  = ko.pureComputed(
			() => bucket() && bucket().name
		);

		this.fileCount = ko.pureComputed(
			() => bucket() && bucket().num_objects
		);

		this.fileCountText = ko.pureComputed(
			() => `${this.fileCount() ? numeral(this.fileCount()).format('0,0') : 'No'} files`
		)		
		
		this.total = ko.pureComputed(
			() => bucket() && bucket().storage.used
		);

		this.totalText = ko.pureComputed(
			() => bucket() && formatSize(bucket().storage.total)
		);

		this.free = ko.pureComputed(
			() => bucket() && bucket().storage.free
		);
>>>>>>> 5899a610afcb3d598d4507eb1f86f1bfdcc9a9cb

        this.freeText = ko.pureComputed(
            () => formatSize(this.free())
        );

<<<<<<< HEAD
        this.used = ko.pureComputed(
            () => bucket().storage.used
        );

        this.usedText = ko.pureComputed(
            () => formatSize(this.used())
        );
=======
		this.used = ko.pureComputed(
			() => bucket() && bucket().storage.used
		);

		this.usedText = ko.pureComputed(
			() => bucket() && formatSize(this.used())
		);
>>>>>>> 5899a610afcb3d598d4507eb1f86f1bfdcc9a9cb

        this.gaugeValues = [ 
            { value: this.used, color: style['text-color6'], emphasize: true },
            { value: this.free, color: style['text-color4'] }
        ]

<<<<<<< HEAD
        this.policy = ko.pureComputed(
            () => bucket().tiering
        );

        this.isPolicyModalVisible = ko.observable(false);
        this.isUploadFilesModalVisible = ko.observable(false);
        this.isCloudSyncModalVisible = ko.observable(false);
    }
=======
		this.policy = ko.pureComputed(
			() => bucket() && bucket().tiering
		);

		this.isPolicyModalVisible = ko.observable(false);
		this.isUploadFilesModalVisible = ko.observable(false);
		this.isCloudSyncModalVisible = ko.observable(true);
	}
>>>>>>> 5899a610afcb3d598d4507eb1f86f1bfdcc9a9cb
}

export default {
    viewModel: BucketSummrayViewModel,
    template: template
}