/* Copyright (C) 2016 NooBaa */

import { realizeUri } from 'utils/browser-utils';
import { formatSize } from 'utils/size-utils';
import { deepFreeze } from 'utils/core-utils';
import { timeShortFormat } from 'config';
import moment from 'moment';
import ko from 'knockout';

const statusMapping = deepFreeze({
    OPTIMAL: {
        css: 'success',
        name: 'healthy',
        tooltip: 'Healthy'
    },
    UPLOADING: {
        css: 'warning',
        name: 'working',
        tooltip: 'Uploading'
    }
});

export default class ObjectRowViewModel {
    constructor({ baseRoute, deleteGroup, onDelete }) {
        this.baseRoute = baseRoute;
        this.onObjectDelete = null;
        this.state = ko.observable();
        this.key = ko.observable();
        this.creationTime = ko.observable();
        this.size = ko.observable();
        this.deleteArgs = ko.observable();

        this.deleteButton = {
            subject: 'object',
            tooltip: ko.observable(),
            disabled: ko.observable(),
            id: ko.observable(),
            group: deleteGroup,
            onDelete: () => onDelete(...this.deleteArgs())
        };
    }

    onState(obj, id, isNotOwner, onDeleteArgs) {
        const deleteTooltip = isNotOwner ? 'This operation is only available for the system owner' : '';
        const size = obj.uploadId ? '...' : formatSize(obj.size);
        const creationTime = moment(obj.createTime).format(timeShortFormat);
        const href = !obj.uploadId ? realizeUri(this.baseRoute, { object: obj.key }) : undefined;
        const key = {
            text: obj.key,
            href,
            tooltip: {
                text: obj.key,
                breakWords: true
            }
        };

        this.state(statusMapping[obj.mode]);
        this.deleteArgs(onDeleteArgs);
        this.key(key);
        this.creationTime(creationTime);
        this.size(size);
        this.deleteButton.id(id);
        this.deleteButton.disabled(isNotOwner);
        this.deleteButton.tooltip(deleteTooltip);
    }
}
