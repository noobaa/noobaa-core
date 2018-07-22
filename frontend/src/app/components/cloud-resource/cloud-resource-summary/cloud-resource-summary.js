/* Copyright (C) 2016 NooBaa */

import template from './cloud-resource-summary.html';
import ConnectableViewModel from 'components/connectable';
import { getCloudResourceStateIcon } from 'utils/resource-utils';
import { getCloudServiceMeta } from 'utils/cloud-utils';
import ko from 'knockout';
import numeral from 'numeral';
import style from 'style';

function _getServiceDisplayName(resource) {
    return resource.type === 'S3_COMPATIBLE' ?
        'S3 Compatible' :
        getCloudServiceMeta(resource.type).displayName;
}

class CloudResourceSummaryViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    state = ko.observable();
    service = ko.observable();
    targetBucket = ko.observable();
    readCount = ko.observable();
    writeCount = ko.observable();
    readSize = ko.observable();
    writeSize = ko.observable();
    chartLegend = [
        {
            label: 'Reads',
            color: style['color16'],
            value: this.readSize
        },
        {
            label: 'Writes',
            color: style['color8'],
            value: this.writeSize
        }
    ];
    chartValues = this.chartLegend
        .map(item => ({ parts: [item] }));

    selectState(state, params) {
        const { cloudResources = {} } = state;
        return [
            cloudResources[params.resourceName]
        ];
    }

    mapStateToProps(resource) {
        if (!resource) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { io } = resource;
            const { tooltip, ...icon } = getCloudResourceStateIcon(resource);
            ko.assignToProps(this, {
                dataReady: true,
                state: {
                    icon:icon,
                    text: tooltip
                },
                service: _getServiceDisplayName(resource),
                targetBucket: resource.target,
                readCount: numeral(io.readCount).format(','),
                writeCount: numeral(io.writeCount).format(','),
                readSize: io.readSize,
                writeSize: io.writeSize
            });
        }
    }
}

export default {
    viewModel: CloudResourceSummaryViewModel,
    template: template
};
