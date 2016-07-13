import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';

const partStateMapping = Object.freeze({
    available: {
        toolTip: 'available',
        icon: 'part-available'
    },
    building: {
        toolTip: 'in process',
        icon: 'part-in-process'
    },
    unavailable: {
        toolTip: 'unavailable',
        icon: 'part-unavailable'
    }
});

export default class ObjectRowViewModel extends Disposable {
    constructor(part) {

        super();

        this.isVisible = ko.pureComputed(
            () => !!part()
        );

        let stateMapping = ko.pureComputed(
            () => part() && partStateMapping[part().info.chunk.adminfo.health]
        );

        this.stateToolTip = ko.pureComputed(
            () => stateMapping() && stateMapping().toolTip
        );

        this.stateIcon = ko.pureComputed(
            () => stateMapping() && stateMapping().icon
        );

        this.object = ko.pureComputed(
            () => part() && part().object
        );

        this.bucket = ko.pureComputed(
            () => part() && part().bucket
        );

        this.startOffset = ko.pureComputed(
            () => part() && numeral(part().info.start).format('0.0 b')
        );

        this.endOffset = ko.pureComputed(
            () => part() && numeral(part().info.end).format('0.0 b')
        );

        this.size = ko.pureComputed(
            () => part() && numeral(
                part().info.end - part().info.start).format('0.0 b'
            )
        );
    }
}
