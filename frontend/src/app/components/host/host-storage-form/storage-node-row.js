import ko from 'knockout';
import numeral from 'numeral';
import {
    getNodeActivityName,
    getNodeActivityStageName,
    getStorageNodeStateIcon,
    getNodeOrHostCapacityBarValues
} from 'utils/host-utils';

function _getActivityString(activity) {
    if (!activity) return 'No activity';

    const { type, progress, stage } = activity;
    const name = getNodeActivityName(type);
    const percentage = numeral(progress).format('%');
    const stageName = getNodeActivityStageName(stage);
    return `${name} (${percentage}) | ${stageName}`;
}

function _formatLatencyValue(latency) {
    return numeral(latency.toFixed(2)).format('0,0');
}

export default class StorageNodeRowViewModel {
    constructor() {
        this.rowCss = ko.observable();
        this.state = ko.observable();
        this.mount = ko.observable();
        this.readLatency = ko.observable();
        this.writeLatency = ko.observable();
        this.capacity = ko.observable();
        this.dataActivity = ko.observable();
    }

    onNode(node) {
        const { mode, mount, readLatency, writeLatency, activity } = node;

        this.rowCss(mode === 'DECOMMISSIONED' ? 'disabled' : '');
        this.state(getStorageNodeStateIcon(node));
        this.mount(mount);
        this.readLatency(`${_formatLatencyValue(readLatency)} ms`);
        this.writeLatency(`${_formatLatencyValue(writeLatency)} ms`);
        this.dataActivity(_getActivityString(activity));
        this.capacity(getNodeOrHostCapacityBarValues(node));
    }
}
