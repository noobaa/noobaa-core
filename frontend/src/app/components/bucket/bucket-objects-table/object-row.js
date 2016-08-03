import { formatSize } from 'utils';
import Disposable from 'disposable';
import ko from 'knockout';

const statusIconMapping = Object.freeze({
    AVALIABLE: {
        tooltip: 'Avaliable',
        icon: 'object-available'
    },
    IN_PROCESS: {
        tooltip: 'In Process',
        icon: 'object-in-process'
    },
    UNAVALIABLE: {
        tooltip: 'Unavaliable',
        icon: 'object-unavailable'
    }
});

export default class ObjectRowViewModel extends Disposable {
    constructor(obj) {
        super();

        this.isVisible = ko.pureComputed(
            () => !!obj()
        );

        this.name = ko.pureComputed(
            () => obj() && obj().key
        );

        let stateMap = ko.pureComputed(
            () => obj() && statusIconMapping[obj().info.state || 'AVALIABLE']
        );

        this.stateTooltip = ko.pureComputed(
            () => stateMap() && stateMap().tooltip
        );

        this.stateIcon = ko.pureComputed(
            () => stateMap() && stateMap().icon
        );

        this.size = ko.pureComputed(
            () => obj() && formatSize(obj().info.size)
        );
    }
}
