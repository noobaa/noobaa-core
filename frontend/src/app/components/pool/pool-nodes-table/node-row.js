import ko from 'knockout';
import { formatSize, avgOp, dblEncode } from 'utils';

export default class NodeRowViewModel {
    constructor(node) {
        this.isVisible = ko.pureComputed(
            () => !!node()
        );

        this.stateToolTip = ko.pureComputed(
            () => node() && node().online  ? 'online' : 'offline'
        );

        this.stateIcon = ko.pureComputed(
            () => node() && `/fe/assets/icons.svg#node-${
                node().online ? 'online' : 'offline'
            }`
        );

        this.name = ko.pureComputed(
            () => node() && node().name
        );

        let diskRead = ko.pureComputed(
            () => node() && node().latency_of_disk_read 
                .reduce(avgOp, 0)
                .toFixed(1)
        );

        let diskWrite = ko.pureComputed(
            () => node() && node().latency_of_disk_write
                .reduce(avgOp, 0)
                .toFixed(1)
        );

        this.diskReadWrite = ko.pureComputed(
            () => {
                if (diskRead() == 0 || diskWrite() == 0) {
                    return 'N/A'
                } 
                return `${diskRead()}/${diskWrite()} ms`;
            }
        );

        this.RTT = ko.pureComputed(
            () => {
                let rtt = node() && node().latency_to_server
                    .reduce(avgOp, 0)
                    .toFixed(1);

                return rtt > 0 ? `${rtt} ms` : 'N/A';
            }
        );

        this.href = ko.pureComputed(
            () => node() && `/fe/systems/:system/pools/:pool/nodes/${
                dblEncode(node().name)
            }`
        );

        this.ip = ko.pureComputed(
            () => node() && node().ip
        );

        this.capacity = ko.pureComputed(
            () => node() && (node().storage ? formatSize(node().storage.total) : 'N/A')
        );
    }
}
