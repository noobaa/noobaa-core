import ko from 'knockout';
import { formatSize,avarageArrayValues, dblEncode } from 'utils';

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

        this.diskRead = ko.pureComputed(
            () => node() && (avarageArrayValues(node().latency_of_disk_read)).toFixed(1) + ' ms'
        );

        this.diskWrite = ko.pureComputed(
            () => node() && (avarageArrayValues(node().latency_of_disk_write)).toFixed(1) + ' ms'
        );

        this.RTT = ko.pureComputed(
            () => node() && (avarageArrayValues(node().latency_to_server)).toFixed(1) + ' ms'
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
