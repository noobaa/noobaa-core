/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { formatSize } from  'utils/size-utils';
import numeral from 'numeral';

const resourceStateIcons = deepFreeze({
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy',
    }
});

const resourceTypeIcons = deepFreeze({
    AWS: {
        name: 'aws-s3-resource',
        tooltip: 'AWS S3 resource'
    },

    AZURE: {
        name: 'azure-resource',
        tooltip: 'Azure blob resource'
    }
});

export default class ExternalResourceRowViewModel {
    constructor() {
        this.state = ko.observable();
        this.type = ko.observable();
        this.resourceName = ko.observable();
        this.targetName = ko.observable();
        this.objectCount = ko.observable();
        this.usage = ko.observable();
    }

    onResource({ mode, type, name, target, objectCount, storage }) {

        this.state(resourceStateIcons[mode]);
        this.type(resourceTypeIcons[type]);
        this.resourceName(name);
        this.targetName(target);
        this.objectCount(numeral(objectCount).format('0,0'));
        this.usage(formatSize(storage.used));
    }
}
