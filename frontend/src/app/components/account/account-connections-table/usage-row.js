import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';

const usageTypeMapping = deepFreeze({
    CLOUD_SYNC: 'Cloud Sync',
    CLOUD_RESOURCE: 'Cloud Resource',
    NAMESPACE_RESOURCE: 'External Resource'
});

export default class UsageRowViewModel {
    constructor() {
        this.noobaaBuckets = ko.observable();
        this.externalEntity = ko.observable();
        this.usageType = ko.observable();
    }

    onUsage(usage, system) {
        const { entity, buckets, externalEntity, usageType } = usage;
        const route = usageType === 'NAMESPACE_RESOURCE' ? routes.gatewayBucket : routes.bucket;
        const noobaaBuckets = {
            text: entity,
            tooltip: { text: buckets, breakWords: true },
            href: usageType === 'CLOUD_SYNC' ?
                realizeUri(route, { system, bucket: entity }) :
                undefined
        };

        this.externalEntity = ko.observable(externalEntity);
        this.usageType = ko.observable(usageTypeMapping[usageType]);
        this.noobaaBuckets(noobaaBuckets);
    }
}
