/* Copyright (C) 2016 NooBaa */

import { realizeUri } from 'utils/browser-utils';
import { formatSize } from 'utils/size-utils';
import { deepFreeze } from 'utils/core-utils';
import { timeShortFormat } from 'config';
import moment from 'moment';
import ko from 'knockout';

const statusMapping = deepFreeze({
    COMPLETED: {
        css: 'success',
        name: 'healthy',
    },
    PROGRESS: {
        css: 'warning',
        name: 'working',
    },
});

export default class ObjectRowViewModel {
    constructor({ baseRoute, deleteGroup, onDelete }) {
        this.baseRoute = baseRoute;
        this.state = ko.observable();
        this.key = ko.observable();
        this.creationTime = ko.observable();
        this.size = ko.observable();

        this.deleteButton = {
            subject: 'object',
            id: ko.observable(),
            tooltip: ko.observable(),
            disabled: ko.observable(),
            group: deleteGroup,
            onDelete: onDelete
        };
    }

    onBucketObject(obj, isOwner) {
        const isUploaded = Boolean(obj.size);
        this.state(isUploaded ? statusMapping.COMPLETED : statusMapping.PROGRESS);
        let key = {
            text: obj.key,
            tooltip: {
                text: obj.key,
                breakWords: true
            }
        };

        if(isUploaded) {
            key.href = realizeUri(this.baseRoute, { object: obj.key });
        }

        this.key(key);
        this.creationTime(moment(obj.createTime).format(timeShortFormat));
        this.size(obj.size ? formatSize(obj.size) : '...');
        this.deleteButton.id(obj.key);
        this.deleteButton.disabled(!isOwner);
        this.deleteButton.tooltip(!isOwner ? 'This operation is only available for the system owner' : '');
    }
}
