import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { stringifyAmount } from 'utils/string-utils';
import * as routes from 'routes';

const usageTypeMapping = deepFreeze({
    CLOUD_RESOURCE: {
        text: 'Cloud Resource',
        route: routes.bucket
    },
    NAMESPACE_RESOURCE: {
        text: 'Namespace Resource',
        route: routes.namespaceBucket
    }
});

function _getNoobaaBuckets(buckets, route, system) {
    return {
        text: stringifyAmount('Bucket', buckets.length),
        tooltip: buckets.length > 0 ? {
            template: 'linkList',
            text: buckets.map(bucket => ({
                text: bucket,
                href: realizeUri(route, { system, bucket })
            }))
        } : null
    };
}

export default class UsageRowViewModel {
    constructor() {
        this.noobaaBuckets = ko.observable();
        this.externalEntity = ko.observable();
        this.usage = ko.observable();
    }

    onUsage(usage, system) {
        const { usageType, externalEntity, entity, buckets } = usage;
        const { text, route } = usageTypeMapping[usageType];
        const usageInfo = {
            text: text,
            tooltip: entity
        };

        this.externalEntity(externalEntity);
        this.usage(usageInfo);
        this.noobaaBuckets(_getNoobaaBuckets(buckets, route, system));
    }
}
