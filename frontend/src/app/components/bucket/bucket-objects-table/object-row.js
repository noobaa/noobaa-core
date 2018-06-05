/* Copyright (C) 2016 NooBaa */

import { realizeUri } from 'utils/browser-utils';
import { formatSize } from 'utils/size-utils';
import { deepFreeze } from 'utils/core-utils';
import { formatVersionId } from 'utils/object-utils';
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
    baseRoute = '';
    onObjectDelete = null;
    state = ko.observable();
    key = ko.observable();
    versionId = ko.observable()
    creationTime = ko.observable();
    size = ko.observable();
    deleteButton = {
        text: ko.observable(),
        id: ko.observable(),
        tooltip: ko.observable(),
        disabled: ko.observable(),
        active: ko.observable(),
        onToggle: null,
        onDelete: null
    };

    constructor({ baseRoute, onSelectForDelete, onDelete }) {
        this.baseRoute = baseRoute;
        this.deleteButton.onDelete = onDelete;
        this.deleteButton.onToggle = onSelectForDelete;
    }

    onState(id, obj, isNotOwner, versionedBucket, showingVersions, selectedForDelete) {
        const deleteTooltip = isNotOwner ? 'This operation is only available for the system owner' : null;
        const versionId = obj.uploadId ? '...' : obj.versionId;
        const size = (obj.uploadId || obj.deleteMarker) ? '...' : formatSize(obj.size.original);
        const creationTime = moment(obj.createTime).format(timeShortFormat);
        const href = (!obj.uploadId && !obj.deleteMarker) ?
            realizeUri(this.baseRoute, { object: obj.key, version: obj.versionId }) :
            undefined;

        const keyText =
            (!versionedBucket && obj.key) ||
            (!showingVersions && obj.key) ||
            (obj.uploadId && obj.key) ||
            (obj.deleteMarker && `${obj.key} (Delete Marker)`) ||
            (obj.latestVersion && `${obj.key} (Latest Verison)`) ||
            obj.key;

        const key = {
            text: keyText,
            href,
            tooltip: {
                text: keyText,
                breakWords: true
            }
        };

        const deleteText =
            (obj.uploadId && 'Abort object upload') ||
            (showingVersions && 'Delete object version') ||
            (versionedBucket && 'Delete latest object version') ||
            'Delete object';

        this.state(statusMapping[obj.mode]);
        this.key(key);
        this.versionId(formatVersionId(versionId));
        this.creationTime(creationTime);
        this.size(size);
        this.deleteButton.id(id);
        this.deleteButton.text(deleteText);
        this.deleteButton.active(id === selectedForDelete);
        this.deleteButton.disabled(isNotOwner);
        this.deleteButton.tooltip(deleteTooltip);
    }
}
