import template from './connect-app-wizard.html';
import selectSlideTemplate from './select-slide.html';
import connecSlideTemplate from './connect-slide.html';
import { domFromHtml } from 'utils';
import ko from 'knockout';
import { bucketList } from 'model';

const connectionTypes = Object.freeze([
	{
		type: 'NATIVE',
		label: 'Native Access',
		description: 'A REST based protocal commonly used by S3 compatible clients (e.g. S3 Browser)',
	},
	{
		type: 'FS',
		label: 'Linux File Access',
		description: 'Please provide a good explanation',
	},
	{
		type: 'HDFS',
		label: 'Big Data Access (HDFS)',
		description: 'Comming Soon...',
		disabled: true
	}
]);

class ConnectApplicationWizard {
	constructor() {
	 	this.selectSlideNodes = domFromHtml(selectSlideTemplate);
	 	this.connectSlideNodes = domFromHtml(connecSlideTemplate);

	 	this.conTypes = connectionTypes;
	 	this.selectedConType = ko.observable(this.conTypes[0]);

		let buckets = [
			'my-first-bucket',
			'default_buckets',
			'ohad',
			'avins-very-long-bucket-name',
			'my-first-bucket-2',
			'default_buckets-2',
			'bla-bla-bla',
			'what-is-this',
			'shiri',			
		]

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
	 	this.selectedBucket(this.buckets[0])
	}
}

export default {
	viewModel: ConnectApplicationWizard,
	template: template
}