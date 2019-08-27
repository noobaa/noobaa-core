/* Copyright (C) 2016 NooBaa */

import template from './cloud-connection-update-warning-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, createCompareFunc } from 'utils/core-utils';
import { getFormValues } from 'utils/form-utils';
import { closeModal } from 'action-creators';

const columns = deepFreeze([
    {
        name: 'resourceName',
        sortable: true,
        compareKey: usage => usage.entity
    },
    {
        name: 'targetBucket',
        sortable: true,
        compareKey: usage => usage.externalEntity
    },
    {
        name: 'usageType',
        label: 'Used as',
        sortable: true,
        compareKey: usage => usage.usageType

    }
]);

class UsageRowViewModel {
    resourceName = ko.observable();
    targetBucket = ko.observable();
    usageType = ko.observable();
}

class CloudConnectionUpdateWarningModalViewModel extends ConnectableViewModel {
    columns = columns;
    formName = this.constructor.name;
    formFields = {
        sorting: {
            sortBy: 'resourceName',
            order: 1
        }
    };
    dataReady = ko.observable();
    updateAction = null;
    rows = ko.observableArray()
        .ofType(UsageRowViewModel);

    selectState(state, params) {
        const { accounts, forms } = state;
        const connections = accounts &&
            accounts[params.accountName] &&
            accounts[params.accountName].externalConnections;

        const connection = (connections || []).find(connection =>
            connection.name === params.connectionName
        );

        return [
            connection && connection.usage,
            params.updateAction,
            forms && forms[this.formName]
        ];
    }

    mapStateToProps(usageList, updateAction, form) {
        if (!usageList || !form) {
            ko.assignToProps(this, {
                dataReady : false
            });

        } else {
            const { sortBy = 'resourceName', order = 1 } = getFormValues(form).sorting;
            const { compareKey } = columns.find(column => column.name === sortBy);

            ko.assignToProps(this, {
                dataReady: true,
                updateAction,
                sorting: { sortBy, order },
                rows: [...usageList]
                    .sort(createCompareFunc(compareKey, order))
                    .map(usage => ({
                        resourceName: usage.entity,
                        targetBucket: usage.externalEntity,
                        usageType:
                            (usage.usageType === 'CLOUD_RESOURCE' && 'Cloud Resource') ||
                            (usage.usageType === 'NAMESPACE_RESOURCE' && 'Namespace Resource') ||
                            'Unknown'
                    }))
            });
        }
    }

    onSave() {
        this.dispatch(
            closeModal(Infinity),
            this.updateAction
        );
    }

    onBack() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: CloudConnectionUpdateWarningModalViewModel,
    template: template
};
