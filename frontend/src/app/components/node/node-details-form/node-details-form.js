import template from './node-details-form.html';
import ko from 'knockout';
import moment from 'moment';
import style from 'style';
import { formatSize, avgOp } from 'utils';

const conactivityTypeMapping = Object.freeze({
    UNKNOWN: 'Unknown',
    TCP: 'TCP',
    UDP: 'UDP'
});

class NodeInfoViewModel {
    constructor({ node  }) {
        this.dataReady = ko.pureComputed(
            () => !!node()
        )

        this.version = ko.pureComputed(
            () => node().version
        );

        this.lastHeartbeat = ko.pureComputed(
            () => moment(node().heartbeat).fromNow()
        );

        this.ip = ko.pureComputed(
            () => node().ip
        );

        this.p2pConactivityType = ko.pureComputed(
            () => conactivityTypeMapping[node().connectivity_type]
        );
        
        this.RTT = ko.pureComputed(
            () => node() && `${
                node().latency_to_server.reduce(avgOp).toFixed(1)
            } ms`
        );

        this.isUDPWarningVisible = ko.pureComputed(
            () => node().connectivity_type === 'UDP'
        );

        this.hostname = ko.pureComputed(
            () => node().os_info.hostname
        );

        this.upTime = ko.pureComputed(
            () => moment(node().os_info.uptime).fromNow(true)
        );

        this.osType = ko.pureComputed(
            () => node().os_info.ostype
        );

        this.cpus = ko.pureComputed(
            () => this._mapCpus(node())
        );

        this.memory = ko.pureComputed(
            () => formatSize(node().os_info.totalmem)
        );

        this.mountName = ko.pureComputed(
            () => node().drives[0].mount
        );

        this.blockDevice = ko.pureComputed(
            () => node().drives[0].drive_id
        );        

        this.diskRead = ko.pureComputed(
            () => node() && `${
                node().latency_of_disk_read.reduce(avgOp).toFixed(1)
            } ms`
        );

        this.diskWrite = ko.pureComputed(
            () => node() && `${
                node().latency_of_disk_write.reduce(avgOp).toFixed(1)
            } ms`
        );
    }

    _mapCpus({ os_info }) {
        return `${os_info.cpus.length}x ${os_info.cpus[0].model}`;
    }
}

export default {
    viewModel: NodeInfoViewModel,
    template: template
}
