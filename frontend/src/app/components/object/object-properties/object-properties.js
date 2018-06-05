/* Copyright (C) 2016 NooBaa */

import template from './object-properties.html';
import ConnectableViewModel from 'components/connectable';
import { getVersioningStateText } from 'utils/bucket-utils';
import { splitObjectId, formatVersionId } from 'utils/object-utils';
import { realizeUri } from 'utils/browser-utils';
import { memoize } from 'utils/core-utils';
import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';
import { timeShortFormat } from 'config';
import { requestLocation } from 'action-creators';

function _getVersionLabel(object) {
    const { deleteMarker, latestVersion } = object;
    const versionId = formatVersionId(object.versionId);
    return true &&
        (deleteMarker && `${versionId} (Delete marker)`) ||
        (latestVersion && `${versionId} (Latest version)`) ||
        versionId;
}

function _mapVersionsOptions(versions, location) {
    if (!versions) {
        return [];
    }

    return versions.map(version => {
        const { versionId, createTime, deleteMarker } = version;
        return {
            value:  realizeUri(location.route, { ...location.params, version: versionId }),
            label: _getVersionLabel(version),
            disabled: deleteMarker,
            remark: moment(createTime).format(timeShortFormat)
        };
    });
}

class ObjectPropertiesViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    isBucketVersioned = ko.observable();
    versionsLoaded = ko.observable();
    versionsOptions = ko.observableArray();
    selectedVersion = ko.observable();
    properties = [
        {
            label: 'Object name',
            value: ko.observable()
        },
        {
            label: 'Content type',
            value: ko.observable()
        },
        {
            label: 'Last Modified',
            value: ko.observable()
        },
        {
            label: 'Last read time',
            value: ko.observable()
        },
        {
            label: 'Number of reads',
            value: ko.observable()
        },
        {
            label: 'File\'s bucket versioning',
            value: ko.observable()
        },
        {
            label: 'Nubmer of versions',
            visible: ko.observable(),
            value: ko.observable()
        },
        {
            label: 'Version ID',
            visible: ko.observable(),
            value: ko.observable()
        }
    ];

    selectVersions = memoize((objects, queryOwner) => {
        const query = objects.queries[objects.views[queryOwner]];
        if (!query || !query.result) return null;

        return query.result.items
            .map(objId => objects.items[objId])
            .sort((v1, v2) => v2.createTime - v1.createTime);
    });

    selectState(state, params) {
        const { location, buckets = {}, objects = {} } = state;
        const { bucket: bucketName } = splitObjectId(params.objectId);

        return [
            location,
            buckets[bucketName],
            objects.items[params.objectId],
            this.selectVersions(objects, params.fetchOwner)
        ];
    }

    mapStateToProps(location, bucket, object, versions) {
        if (!bucket || !object) {
            ko.assignToProps(this, { objectLoaded: false });

        } else {
            const versionCount = versions ? numeral(versions.length).format(',') : 'calculating...';
            const bucketVersioningMode = bucket.versioning.mode;
            const isBucketVersioned = bucketVersioningMode !== 'DISABLED';

            ko.assignToProps(this, {
                dataReady: true,
                isBucketVersioned,
                versionsLoaded: Boolean(versions),
                versionsOptions: _mapVersionsOptions(versions, location),
                selectedVersion: location.pathname,
                properties: [
                    { value: object.key },
                    { value: object.contentType },
                    { value: moment(object.createTime).format(timeShortFormat) },
                    { value: object.lastReadTime ? moment(object.lastReadTime) : 'Not read yet' },
                    { value: numeral(object.readCount).format(',') },
                    { value: getVersioningStateText(bucketVersioningMode) },
                    { value: versionCount, visible: isBucketVersioned },
                    { value: _getVersionLabel(object), visible: isBucketVersioned }
                ]
            });
        }
    }

    onSelectVersion(versionUrl) {
        this.dispatch(requestLocation(versionUrl));
    }

}

export default {
    viewModel: ObjectPropertiesViewModel,
    template: template
};
