import ko from 'knockout';
import numeral from 'numeral';

const partStateIconMapping = Object.freeze({
    available:     '/fe/assets/icons.svg#part-available',
    in_process: '/fe/assets/icons.svg#part-in-process',
    unavailable:'/fe/assets/icons.svg#part-unavailable' 
});

export default class ObjectRowViewModel {
    constructor(part) {
        this.isVisible = ko.pureComputed(
            () => !!part()
        );

        this.stateIcon = ko.pureComputed(
            () => !!part() && partStateIconMapping[part().info.chunk.adminfo.health] 
        );

        this.object = ko.pureComputed(
            () => !!part() && part().object
        );

        this.bucket = ko.pureComputed(
            () => !!part() && part().bucket
        );

        this.href = ko.pureComputed(
            () => !!part() && `/fe/systems/:system/buckets/${part().bucket}/objects/${part().object}`
        );

        this.startOffset = ko.pureComputed(
            () => !!part() && numeral(part().info.start).format('0.0b')
        );

        this.endOffset = ko.pureComputed(
            () => !!part() && numeral(part().info.end).format('0.0b')
        );

        this.size = ko.pureComputed(
            () => !!part() && numeral(part().info.size).format('0.0b')
        )
    }
}