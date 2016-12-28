import template from './node-details-form.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import moment from 'moment';
import { avgOp } from 'utils/all';
import { systemInfo } from 'model';
import { decommissionNode, recommissionNode } from 'actions';

const conactivityTypeMapping = Object.freeze({
    UNKNOWN: 'Unknown',
    TCP: 'TCP',
    UDP: 'UDP <span class="warning">(Not optimized for performance)</span>'
});

class NodeInfoViewModel extends BaseViewModel {
    constructor({ node  }) {
        super();

        this.dataReady = ko.pureComputed(
            () => !!node()
        );

        this.name = ko.pureComputed(
            () => node().name
        );

        this.isDecommissioned = ko.pureComputed(
            () => node().decommissioning || node().decommissioned
        );

        this.isDemoNode = ko.pureComputed(
            () => node().demo_node
        );

        this.toggleButtonLabel = ko.pureComputed(
            () => this.isDecommissioned() ? 'Activate Node' : 'Deactivate Node'
        );

        this.toggleButtonTooltip = ko.pureComputed(
            () => this.isDemoNode() ?
                'Deactivating a node is not supported for demo nodes' :
                ''
        );

        const version = ko.pureComputed(
            () => `${
                node().version
            } ${
                node().version === systemInfo().version ?
                    '(Up to date)' :
                    '<span class="error">(Not up to date, waiting for next heartbeat)</span>'
            }</span>`
        );

        const lastHeartbeat = ko.pureComputed(
            () => moment(node().heartbeat).fromNow()
        );

        const ip = ko.pureComputed(
            () => node().ip
        );

        const serverEndpoint = ko.pureComputed(
            () => node().base_address
        );

        const p2pConectivityType = ko.pureComputed(
            () => conactivityTypeMapping[node().connectivity]
        );

        const RTT = ko.pureComputed(
            () => node() && `${
                node().latency_to_server.reduce(avgOp, 0).toFixed(1)
            } ms`
        );

        this.agentInfo = [
            {
                label: 'Node Name',
                value: this.name
            },
            {
                label: 'Installed Version',
                value: version
            },
            {
                label: 'Heartbeat',
                value: lastHeartbeat
            },
            {
                label: 'Communication IP',
                value: ip
            },
            {
                label: 'Peer to Peer Connectivity',
                value: p2pConectivityType
            },
            {
                label: 'Server Endpoint',
                value: serverEndpoint
            },
            {
                label: 'Round Trip Time',
                value: RTT
            }
        ];

        const hostname = ko.pureComputed(
            () => node().os_info.hostname
        );

        const upTime = ko.pureComputed(
            () => moment(node().os_info.uptime).fromNow(true)
        );

        const osType = ko.pureComputed(
            () => node().os_info.ostype
        );

        const cpus = ko.pureComputed(
            () => this._mapCpus(node())
        );

        const memory = ko.pureComputed(
            () => node().os_info.totalmem
        ).extend({
            formatSize: true
        });

        this.systemInfo = [
            {
                label: 'Host Name',
                value: hostname
            },
            {
                label: 'Up Time',
                value: upTime
            },
            {
                label: 'OS Type',
                value: osType
            },
            {
                label: 'CPUs',
                value: cpus
            },
            {
                label: 'Memory',
                value: memory
            }
        ];

        const mountName = ko.pureComputed(
            () => node().drives[0].mount
        );

        const blockDevice = ko.pureComputed(
            () => node().drives[0].drive_id
        );

        const diskRead = ko.pureComputed(
            () => {
                const avg = node() && node().latency_of_disk_read
                    .reduce(avgOp, 0)
                    .toFixed(1);

                return avg === 0 ? 'N/A' : `${avg} ms`;
            }
        );

        const diskWrite = ko.pureComputed(
            () => {
                const avg = node() && node().latency_of_disk_write
                    .reduce(avgOp, 0)
                    .toFixed(1);

                return avg === 0 ? 'N/A' : `${avg} ms`;
            }
        );

        this.driveInfo = [
            {
                label: 'Mount',
                value: mountName
            },
            {
                label: 'Block Device',
                value: blockDevice
            },
            {
                label: 'Read Latency',
                value: diskRead
            },
            {
                label: 'Write Latency',
                value: diskWrite
            }
        ];
    }

    toggleNode() {
        this.isDecommissioned() ?
            recommissionNode(this.name()) :
            decommissionNode(this.name());
    }

    _mapCpus({ os_info }) {
        return `${os_info.cpus.length} x ${os_info.cpus[0].model}`;
    }
}

export default {
    viewModel: NodeInfoViewModel,
    template: template
};
