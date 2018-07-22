/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { stringifyAmount } from 'utils/string-utils';
import * as routes from 'routes';

const usageTypeMapping = deepFreeze({
    CLOUD_RESOURCE: {
        text: 'Cloud Resource',
        usageRoute: routes.cloudResource,
        bucketRoute: routes.bucket

    },
    NAMESPACE_RESOURCE: {
        text: 'Namespace Resource',
        usageRoute: '',
        bucketRoute: routes.namespaceBucket
    }
});

function _getUsage(type, entity, system) {
    const { text, usageRoute } = usageTypeMapping[type];
    const href = usageRoute ?
        realizeUri(usageRoute, { system, resource: entity }) :
        '';

    return {
        text,
        tooltip: !href ? entity : {
            template: 'link',
            text: { href, text: entity }
        }
    };
}

function _getNoobaaBuckets(usageType, buckets, system) {
    const { bucketRoute } = usageTypeMapping[usageType];

    return {
        text: stringifyAmount('Bucket', buckets.length),
        tooltip: buckets.length > 0 ? {
            template: 'linkList',
            text: buckets.map(bucket => ({
                text: bucket,
                href: realizeUri(bucketRoute, { system, bucket })
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

        this.externalEntity(externalEntity);
        this.usage(_getUsage(usageType, entity, system));
        this.noobaaBuckets(_getNoobaaBuckets(usageType, buckets, system));
    }
}
