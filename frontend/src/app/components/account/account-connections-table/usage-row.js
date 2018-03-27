import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { stringifyAmount } from 'utils/string-utils';
import * as routes from 'routes';

const usageTypeMapping = deepFreeze({
    CLOUD_SYNC: {
        text: 'Cloud Sync',
        route: routes.bucket
    },
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
    if (buckets.length === 1) {
        const [ bucket ] = buckets;
        return {
            text: bucket,
            tooltip: bucket,
            href: realizeUri(route, { system, bucket })
        };

    } else {
        const bucketCount = buckets.length;
        return {
            text: stringifyAmount('Bucket', bucketCount),
            tooltip: bucketCount ? buckets : null
        };
    }
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
