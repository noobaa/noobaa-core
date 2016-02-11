import template from './connect-app-wizard.html';
import selectSlideTemplate from './select-slide.html';
import connecSlideTemplate from './connect-slide.html';
import ko from 'knockout';
import { bucketList, systemInfo } from 'model';
import { copyTextToClipboard } from 'utils';
import { loadBucketList } from 'actions';

const connectionTypes = Object.freeze([
    {
        type: 'NATIVE',
        label: 'Native Access',
        description: 'A REST based protocal commonly used by S3 compatible clients (e.g. S3 Browser)',
    },
    {
        type: 'FS',
        label: 'Linux File Access (Using Fuse)',
        description: 'Comming Soon...',
        disabled: true
    },
    {
        type: 'HDFS',
        label: 'Big Data Access (HDFS)',
        description: 'Comming Soon...',
        disabled: true
    }
]);

class ConnectApplicationWizard {
    constructor({ onClose }) {
        this.onClose = onClose;
         this.selectSlideTemplate = selectSlideTemplate;
         this.connectSlideTemplate = connecSlideTemplate;

         this.conTypes = connectionTypes;
         this.selectedConType = ko.observable(this.conTypes[0]);

        let buckets = bucketList.map(
            bucket => bucket.name
        );

        this.selectedBucket = ko.observable();
        this.buckets = buckets.map(
            (name, i) => {
                let item = {
                    name: name,
                    selected: ko.pureComputed({
                        read: () => this.selectedBucket() === item,
                        write: val => val === true && this.selectedBucket(item)
                    }),
                    icon: ko.pureComputed(
                        () => `/fe/assets/icons.svg#bucket-${
                            item.selected() ? 'selected' : 'unselected'
                        }`
                    )
                }

                if (i() === 0) {
                    item.selected(true);
                }

                return item;
            }
        );
    
         this.endpoint = ko.pureComputed(
             () => systemInfo().endpoint
         );

         this.accessKey = ko.pureComputed(
             () => systemInfo().accessKey
         );

         this.secretKey = ko.pureComputed(
             () => systemInfo().secretKey
         );

         loadBucketList();
    }

    copyToClipboard(text) {
        copyTextToClipboard(ko.unwrap(text));
    }
}

export default {
    viewModel: ConnectApplicationWizard,
    template: template
}