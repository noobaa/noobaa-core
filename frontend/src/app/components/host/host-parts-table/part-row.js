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

    onPart(part, system) {
        const { mode, object, bucket, start, end } = part;
        const objectHref = realizeUri(routes.object, { system, bucket, object });

        this.state(modeToIcon[mode]);
        this.object({ text: object, href: objectHref });
        this.bucket(bucket);
        this.start(numeral(start).format('0.0 b'));
        this.end(numeral(start).format('0.0 b'));
        this.size(numeral(end - start).format('0.0 b'));
    }
}
