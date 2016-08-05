import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';

const partHealthMapping = Object.freeze({
    available: {
        name: 'part-available',
        tooltip: 'available'
    },
    building: {
        name: 'part-in-process',
        tooltip: 'in process'
    },
    unavailable: {
        name: 'part-unavailable',
        tooltip: 'unavailable'
    }
});

export default class ObjectRowViewModel extends Disposable {
    constructor(part) {

        super();

        this.state = ko.pureComputed(
            () => {
                if (!part()) {
                    return '';
                }

                let health = part().chunk.adminfo.health;
                return partHealthMapping[health];
            }
        );

        this.object = ko.pureComputed(
            () => {
                if (!part()) {
                    return '';
                }

                return {
                    text: part().object,
                    href: {
                        route: 'object',
                        params: {
                            bucket: part().bucket,
                            object: part().object,
                            tab: null
                        }
                    }
                };
            }
        );

        this.bucket = ko.pureComputed(
            () => part() ? part().bucket : ''
        );

        this.startOffset = ko.pureComputed(
            () => part() ? numeral(part().start).format('0.0 b') : ''
        );

        this.endOffset = ko.pureComputed(
            () => part() ? numeral(part().end).format('0.0 b') : ''
        );

        this.size = ko.pureComputed(
            () => part() ?
                numeral(part().end - part().start).format('0.0 b') :
                ''
        );
    }
}
