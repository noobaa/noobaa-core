import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import numeral from 'numeral';
import * as routes from 'routes';

const modeToIcon = deepFreeze({
    AVAILABLE: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Available'
    },
    BUILDING: {
        name: 'working',
        css: 'warning',
        tooltip: 'In process'
    },
    UNAVAILABLE: {
        name: 'problem',
        css: 'error',
        tooltip: 'Unavailable'
    }
});

export default class PartRowViewModel {
    constructor() {
        this.state = ko.observable();
        this.object = ko.observable();
        this.bucket = ko.observable();
        this.start = ko.observable();
        this.end = ko.observable();
        this.size = ko.observable();
    }

    onState(part, system) {
        const { mode, object, bucket, start, end } = part;
        const objectCell = {
            text: object,
            href: realizeUri(routes.object, { system, bucket, object }),
            tooltip: object
        };
        const bucketCell = {
            text: bucket,
            href: realizeUri(routes.bucket, { system, bucket }),
            tooltip: bucket
        };

        this.state(modeToIcon[mode]);
        this.object(objectCell);
        this.bucket(bucketCell);
        this.start(numeral(start).format('0.0 b'));
        this.end(numeral(end).format('0.0 b'));
        this.size(numeral(end - start).format('0.0 b'));
    }
}
