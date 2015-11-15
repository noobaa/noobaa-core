import template from './node-info.html';
import ko from 'knockout';
import moment from 'moment';
import style from 'style';
import { node } from 'services/api';
import { formatSize } from 'utils';

const nodeName = 'nb-ohad-server-6e43a1f0-dcb1-4c9e-85d9-db45a151ca11';

class NodeInfoViewModel {
	constructor(params) {
		this.version = ko.observable();
		this.hostname = ko.observable();
		this.upTime = ko.observable();
		this.osType = ko.observable();
		this.cpus = ko.observable();
		this.memory = ko.observable();
		this.totalSize = ko.observable();
		this.drives = ko.observableArray();
		this.networks = ko.observableArray();		

		node.read_node({ name: nodeName })
			.then(node => this._mapData(node))
			.done();
	}

	_mapData(node) {
		let { os_info } = node;

		this.version(node.version);
		this.hostname(os_info.hostname);
		this.upTime(moment(os_info.uptime).fromNow(true));
		this.osType(os_info.ostype);
		this.cpus(`${os_info.cpus.length}x ${os_info.cpus[0].model}`);
		this.memory(formatSize(os_info.totalmem));
		this.networks(this._mapNetwotkInterfaces(os_info.networkInterfaces));
		this.totalSize(formatSize(node.storage.total));
		this.drives(this._mapDrives(node.drives)) 
	}

	_mapNetwotkInterfaces(networkInterfaces) {
		return Object.keys(networkInterfaces).map( controller => {
			return { 
				controller: controller, 
				interfaces: networkInterfaces[controller].map( addr => addr.address )
			};
		});
	}

	_mapDrives(drives) {
		return drives.map( ({ mount, storage }) => {
			let { total, used = 0, free} = storage;
			let os = total - (used + free);

			return {
				name: mount,
				values: [
					{ value: used, label: formatSize(used),	color: style['text-color6'] },
					{ value: os,   label: formatSize(os),	color: style['text-color2'] },
					{ value: free, label: formatSize(free),	color: style['text-color5'] }
				]
			};
		});
	}
}

export default {
	viewModel: NodeInfoViewModel,
	template: template
}