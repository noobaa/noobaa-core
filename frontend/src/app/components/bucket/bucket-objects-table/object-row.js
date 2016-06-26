import { formatSize } from 'utils';
import ko from 'knockout';

const statusIconMapping = Object.freeze({
    AVALIABLE: {
        toolTip: 'Avaliable',
        icon: 'object-available'
    },
    IN_PROCESS: {
        toolTip: 'In Process',
        icon: 'object-in-process'
    },
    UNAVALIABLE: {
        toolTip: 'Unavaliable',
        icon: 'object-unavailable'
    }
});

export default class ObjectRowViewModel {
    constructor(obj) {
        this.isVisible = ko.pureComputed(
            () => !!obj()
        );

        this.name = ko.pureComputed(
            () => obj() && obj().key
        );

        let stateMap = ko.pureComputed(
            () => obj() && statusIconMapping[obj().info.state || 'AVALIABLE']
        );

        this.stateToolTip = ko.pureComputed(
            () => stateMap() && stateMap().toolTip
        );

        this.stateIcon = ko.pureComputed(
            () => stateMap() && stateMap().icon
        );

        this.size = ko.pureComputed(
            () => obj() && formatSize(obj().info.size)
        );
    }
}
