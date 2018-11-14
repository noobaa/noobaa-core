import ko from 'knockout';
import numeral from 'numeral';
import {
    getActivityName,
    getActivityStageName,
    getStorageNodeStateIcon,
    getNodeOrHostCapacityBarValues
} from 'utils/host-utils';

function _getActivityString(activity) {
    if (!activity) return 'No activity';

    const { kind, progress, stage } = activity;
    const name = getActivityName(kind);
    const percentage = numeral(progress).format('%');
    const stageName = getActivityStageName(stage);
    return `${name} (${percentage}) | ${stageName}`;
}

function _formatLatencyValue(latency) {
    const format = true &&
        (latency > 99 && '0,0') ||
        (latency > 9 && '0.0') ||
        '0.00';

    return numeral(latency).format(format);
}

export default class StorageNodeRowViewModel {
    constructor() {
        this.state = ko.observable();
        this.mount = ko.observable();
        this.readLatency = ko.observable();
        this.writeLatency = ko.observable();
        this.capacity = ko.observable();
        this.dataActivity = ko.observable();
        this.isDisabled = ko.observable();
    }

    onNode(node) {
        const { mode, mount, readLatency, writeLatency, activity } = node;

        this.state(getStorageNodeStateIcon(node));
        this.mount(mount);
        this.readLatency(`${_formatLatencyValue(readLatency)} ms`);
        this.writeLatency(`${_formatLatencyValue(writeLatency)} ms`);
        this.dataActivity(_getActivityString(activity));
        this.capacity(getNodeOrHostCapacityBarValues(node));
        this.isDisabled(mode === 'DECOMMISSIONED');
    }
}
