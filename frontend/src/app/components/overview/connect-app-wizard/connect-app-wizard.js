import template from './connect-app-wizard.html';
import selectSlideTemplate from './select-slide.html';
import connecSlideTemplate from './connect-slide.html';
import ko from 'knockout';
import { bucketList, systemOverview } from 'model';
import { serverAddress } from 'config';
import { copyTextToClipboard } from 'utils';

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
			name => {
				let item = {
					name: name,
					selected: ko.pureComputed({
						read: () => this.selectedBucket() === item,
						write: this.selectedBucket
					}),
					icon: ko.pureComputed(
						() => `/assets/icons.svg#bucket-${
							item.selected() ? 'selected' : 'unselected'
						}`
					)
				}

				return item;
			}
		);
	 	this.selectedBucket(this.buckets()[0]);
	
	 	this.endpoint = serverAddress;
	 	this.accessKey = ko.pureComputed(
	 		() => systemOverview().keys.access
 		);
 		this.secretKey = ko.pureComputed(
	 		() => systemOverview().keys.secret
 		);
	}

	copyToClipboard(text) {
		copyTextToClipboard(ko.unwrap(text));
	}
}

export default {
	viewModel: ConnectApplicationWizard,
	template: template
}