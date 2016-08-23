import template from './node-details-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import moment from 'moment';
import { formatSize, avgOp } from 'utils';

const conactivityTypeMapping = Object.freeze({
    UNKNOWN: 'Unknown',
    TCP: 'TCP',
    UDP: 'UDP <span class="warning">(Not optimized for performance)</span>'
});

class NodeInfoViewModel extends Disposable {
    constructor({ node  }) {
        super();

        this.dataReady = ko.pureComputed(
            () => !!node()
        );

        let version = ko.pureComputed(
            () => node().version
        );

        let lastHeartbeat = ko.pureComputed(
            () => moment(node().heartbeat).fromNow()
        );

        let ip = ko.pureComputed(
            () => node().ip
        );

        let p2pConectivityType = ko.pureComputed(
            () => conactivityTypeMapping[node().connectivity]
        );

        let RTT = ko.pureComputed(
            () => node() && `${
                node().latency_to_server.reduce(avgOp, 0).toFixed(1)
            } ms`
        );

        this.agentInfo = [
            { label: 'Installed Version', value: version},
            { label: 'Heartbeat', value: lastHeartbeat},
            { label: 'Communication IP', value: ip},
            { label: 'Peer to Peer Connectivity', value: p2pConectivityType },
            { label: 'Round Trip Time', value: RTT }
        ];

        let hostname = ko.pureComputed(
            () => node().os_info.hostname
        );

        let upTime = ko.pureComputed(
            () => moment(node().os_info.uptime).fromNow(true)
        );

        let osType = ko.pureComputed(
            () => node().os_info.ostype
        );

        let cpus = ko.pureComputed(
            () => this._mapCpus(node())
        );

        let memory = ko.pureComputed(
            () => formatSize(node().os_info.totalmem)
        );

        this.systemInfo = [
            { label: 'Host Name', value: hostname},
            { label: 'Up Time', value: upTime},
            { label: 'OS Type', value: osType },
            { label: 'CPUs', value: cpus },
            { label: 'Memory', value: memory }
        ];

        let mountName = ko.pureComputed(
            () => node().drives[0].mount
        );

        let blockDevice = ko.pureComputed(
            () => node().drives[0].drive_id
        );

        let diskRead = ko.pureComputed(
            () => {
                let avg = node() && node().latency_of_disk_read
                    .reduce(avgOp, 0)
                    .toFixed(1);

                return avg === 0 ? 'N/A' : `${avg} ms`;
            }
        );

        let diskWrite = ko.pureComputed(
            () => {
                let avg = node() && node().latency_of_disk_write
                    .reduce(avgOp, 0)
                    .toFixed(1);

                return avg === 0 ? 'N/A' : `${avg} ms`;
            }
        );

        this.driveInfo = [
            { label: 'Mount', value: mountName },
            { label: 'Block Device', value: blockDevice },
            { label: 'Read Latency', value: diskRead },
            { label: 'Write Latency', value: diskWrite }
        ];
    }

    _mapCpus({ os_info }) {
        return `${os_info.cpus.length} x ${os_info.cpus[0].model}`;
    }
}

export default {
    viewModel: NodeInfoViewModel,
    template: template
};
