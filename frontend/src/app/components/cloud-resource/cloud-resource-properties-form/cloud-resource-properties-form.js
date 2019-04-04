/* Copyright (C) 2016 NooBaa */

import template from './cloud-resource-properties-form.html';
import ConnectableViewModel from 'components/connectable';
import { formatSize } from 'utils/size-utils';
import { unassignedRegionText } from 'utils/resource-utils';
import { openAssignRegionModal } from 'action-creators';
import ko from 'knockout';
import { timeShortFormat } from 'config';
import moment from 'moment';

class CloudResourcePropertiesFormViewModel extends ConnectableViewModel {
    resourceName = '';
    dataReady = ko.observable();
    properties = [
        {
            label: 'Resource name',
            value: ko.observable()
        },
        {
            label: 'Service endpoint',
            value: ko.observable()
        },
        {
            label: 'Cloud target bucket',
            value: ko.observable()
        },
        {
            label: 'Region',
            value: ko.observable()
        },
        {
            label: 'Used capacity (by NooBaa)',
            value: ko.observable()
        },
        {
            label: 'Created by',
            value: ko.observable()
        },
        {
            label: 'Creation time',
            value: ko.observable()
        }
    ];

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
            ko.assignToProps(this, {
                dataReady: true,
                resourceName: resource.name,
                properties: [
                    { value: resource.name },
                    { value: resource.endpoint },
                    { value: resource.target },
                    { value: resource.region || unassignedRegionText },
                    { value: formatSize(resource.storage.used) },
                    { value: resource.createdBy },
                    { value: moment(resource.creationTime).format(timeShortFormat) }
                ]
            });
        }
    }

    onAssignRegion() {
        this.dispatch(openAssignRegionModal('CLOUD', this.resourceName));
    }
}

export default {
    viewModel: CloudResourcePropertiesFormViewModel,
    template: template
};
