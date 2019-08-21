/* Copyright (C) 2016 NooBaa */

import template from './edit-k8s-pool-modal.html';
import connectedBucketsTooltipTemplates from './connected-buckets-tooltip.html';
import ConnectableViewModel from 'components/connectable';
import { formatSize, toSizeAndUnit, unitsInBytes, sumSize, compareSize } from 'utils/size-utils';
import { getFormValues} from 'utils/form-utils';
import { flatPlacementPolicy } from 'utils/bucket-utils';
import { closeModal, openConfirmDangerousScalingModal, scaleHostsPool } from 'action-creators';
import { deepFreeze, flatMap } from 'utils/core-utils';
import ko from 'knockout';
import numeral from 'numeral';

const selectedCapacityTooLowWarning = () => `
    The configured storage is not enough to store all data on this resource.
    This issue can reflect on the resource health and on its connected buckets health
`;
const usedCapacityAboveConfigWarning = used => `
    This pool currently stores ${formatSize(used)} of data.
    The selected storage configuration will not be enough to continue storing the data
`;

const poolIsScalingNotif = configuredCapacity => `
    This pool is currently scaling, its capacity will settle on ${formatSize(configuredCapacity)} once the process is done.
`;

const unitOptions = deepFreeze([
    'GB',
    'TB',
    'PB'
]);

function _getCapacityInBytes(hostCount, size, unit) {
    return hostCount * size * unitsInBytes[unit];
}

function _getConnectedBucketsInfo(buckets, poolName) {
    return flatMap(Object.values(buckets), bucket => flatPlacementPolicy(bucket))
        .filter(item =>
            item.resource.type === 'HOSTS' &&
            item.resource.name === poolName
        )
        .map(item => {
            const {
                replicas = 0,
                dataFrags = 0,
                parityFrags = 0
            } = buckets[item.bucket].resiliency;

            return  {
                name: item.bucket,
                requiredHosts: replicas + dataFrags + parityFrags
            };
        });
}

function _getConnectedBucketsTooltip(connectedBuckets, hostCount, requiredHostCount) {
    if (hostCount < requiredHostCount) {
        return {
            template: connectedBucketsTooltipTemplates,
            text: {
                buckets: connectedBuckets
                    .filter(bucket => bucket.requiredHosts > hostCount)
                    .map(bucket => bucket.name),
                recommendedHostCount: numeral(requiredHostCount).format(',')
            }
        };

    } else {
        return {
            template: 'list',
            text: connectedBuckets.map(bucket => bucket.name)
        };
    }


}

class EditK8SPoolModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    poolName = '';
    isSelectedCapacityBelowUsed = false;
    unitOptions = unitOptions;
    summary = [
        {
            label:'Current Pool Capacity',
            value: ko.observable(),
            css: 'highlight',
            icon: ko.observable(),
            tooltip: {
                position: 'above',
                text: ko.observable()
            }
        },
        {
            label:'After Configuration',
            value: ko.observable(),
            css: ko.observable(),
            icon: ko.observable(),
            tooltip: {
                position: 'above',
                text: ko.observable()
            }
        },
        {
            label: 'Used',
            value: ko.observable(),
            css: ko.observable(),
            icon: ko.observable(),
            tooltip: {
                position: 'above',
                text: ko.observable()
            }
        },
        {
            label: 'Connected Buckets',
            value: ko.observable(),
            css: ko.observable(),
            icon: ko.observable(),
            tooltip: {
                template: ko.observable(),
                position: 'above',
                text: ko.observable()
            }
        }
    ];
    formFields = ko.observable();

    selectState(state, params) {
        const { hostPools, buckets, forms } = state;
        return [
            hostPools && hostPools[params.poolName],
            buckets,
            forms[this.formName]
        ];
    }

    mapStateToProps(pool, buckets, form) {
        if (!pool || !buckets) {
            return;
        }

        const volumeSize = toSizeAndUnit(pool.hostConfig.volumeSize);
        const {
            pvSize = volumeSize.size,
            pvSizeUnit = volumeSize.unit,
            nodeCount = pool.configuredHostCount
        } = form ? getFormValues(form) : {} ;
        const configuredCapacity = _getCapacityInBytes(pool.configuredHostCount, volumeSize.size, volumeSize.unit);
        const selectedCapacity = _getCapacityInBytes(nodeCount, pvSize, pvSizeUnit);
        const { total, used, usedOther } = pool.storage;
        const usedCapacity = sumSize(used, usedOther);
        const isSelectedCapacityBelowUsed = compareSize(selectedCapacity, usedCapacity) < 0;
        const connectedBuckets = _getConnectedBucketsInfo(buckets, pool.name);
        const requiredHostCount = Math.max(...connectedBuckets.map(bucket => bucket.requiredHosts));
        const notEnoughHosts = nodeCount < requiredHostCount;

        ko.assignToProps(this, {
            poolName: pool.name,
            isSelectedCapacityBelowUsed,
            summary: [
                {
                    value: formatSize(total),
                    icon: total != configuredCapacity ? 'notif-info' : '',
                    tooltip: {
                        text: poolIsScalingNotif(configuredCapacity)
                    }
                },
                {
                    value: formatSize(selectedCapacity),
                    css: isSelectedCapacityBelowUsed ? 'error' : 'highlight',
                    icon: isSelectedCapacityBelowUsed ? 'problem' : '',
                    tooltip: {
                        text: isSelectedCapacityBelowUsed ?
                            selectedCapacityTooLowWarning() :
                            ''
                    }
                },
                {
                    value: formatSize(usedCapacity),
                    css: isSelectedCapacityBelowUsed ? 'error' : 'highlight',
                    icon: isSelectedCapacityBelowUsed ? 'problem' : '',
                    tooltip: {
                        text: isSelectedCapacityBelowUsed ?
                            usedCapacityAboveConfigWarning(usedCapacity) :
                            ''
                    }
                },
                {
                    value: numeral(connectedBuckets.length).format(','),
                    css: notEnoughHosts ? 'warning' : 'highlight',
                    icon: connectedBuckets.length ? (notEnoughHosts ? 'problem' : 'notif-info') : '',
                    tooltip: _getConnectedBucketsTooltip(connectedBuckets, nodeCount, requiredHostCount)
                }
            ],
            formFields: !form ? {
                nodeCount: pool.configuredHostCount,
                pvSize: volumeSize.size,
                pvSizeUnit: volumeSize.unit
            } : undefined
        });
    }


    onValidate(values) {
        const errors = {};
        const { nodeCount, pvSize } = values;

        if (nodeCount < 1 || !Number.isInteger(nodeCount)) {
            errors.nodeCount = 'Please enter a whole number greater than 0';
        }

        if (pvSize < 1 || !Number.isInteger(pvSize)) {
            errors.pvSize = 'Please enter a whole number greater than 0';
        }

        return errors;
    }

    onSubmit(values) {
        const { nodeCount } = values;
        const scaleAction = scaleHostsPool(this.poolName, nodeCount);

        if (this.isSelectedCapacityBelowUsed) {
            this.dispatch(
                openConfirmDangerousScalingModal(scaleAction)
            );

        } else {
            this.dispatch(
                closeModal(),
                scaleAction
            );
        }
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: EditK8SPoolModalViewModel,
    template: template
};
