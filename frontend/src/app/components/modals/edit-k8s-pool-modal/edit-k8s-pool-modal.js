/* Copyright (C) 2016 NooBaa */

import template from './edit-k8s-pool-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { formatSize, toSizeAndUnit, unitsInBytes } from 'utils/size-utils';
import { getFormValues} from 'utils/form-utils';
import numeral from 'numeral';
import { closeModal, scaleHostsPool } from 'action-creators';
import { deepFreeze } from 'utils/core-utils';

const unitOptions = deepFreeze([
    'GB',
    'TB',
    'PB'
]);

class EditK8SPoolModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    poolName = '';
    unitOptions = unitOptions;
    formattedNodeCount = ko.observable();
    formattedCapacity = ko.observable();
    formFields = ko.observable();

    selectState(state, params) {
        const { hostPools, forms } = state;
        return [
            hostPools && hostPools[params.poolName],
            forms[this.formName]
        ];
    }

    mapStateToProps(pool, form) {
        if (!pool) {
            return;
        }

        if (form) {
            const { nodeCount, pvSize, pvSizeUnit } = getFormValues(form);
            ko.assignToProps(this, {
                poolName: pool.name,
                formattedNodeCount: numeral(nodeCount).format(','),
                formattedCapacity: formatSize(nodeCount * pvSize * unitsInBytes[pvSizeUnit])
            });

        } else {
            const nodeCount = pool.configuredHostCount;
            const volumeSize = pool.hostConfig.volumeSize;
            const { size, unit } = toSizeAndUnit(volumeSize);
            ko.assignToProps(this, {
                poolName: pool.name,
                formattedNodeCount: numeral(nodeCount).format(','),
                formattedCapacity: formatSize(volumeSize),
                formFields: {
                    nodeCount,
                    pvSize: size,
                    pvSizeUnit: unit
                }
            });
        }
    }


    onValidate(values) {
        const errors = {};
        const { nodeCount, pvSize } = values;

        if (nodeCount < 1 || !Number.isInteger(nodeCount)) {
            errors.nodeCount = 'Please enter a whole number greater then 0';
        }

        if (pvSize < 1 || !Number.isInteger(pvSize)) {
            errors.pvSize = 'Please enter a whole number greater then 0';
        }

        return errors;
    }

    onSubmit(values) {
        const { nodeCount } = values;

        this.dispatch(
            closeModal(),
            scaleHostsPool(this.poolName, nodeCount)
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: EditK8SPoolModalViewModel,
    template: template
};
