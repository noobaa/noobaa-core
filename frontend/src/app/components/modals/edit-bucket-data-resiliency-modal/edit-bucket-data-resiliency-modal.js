/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-data-resiliency-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import ko from 'knockout';
import numeral from 'numeral';
import { state$, action$ } from 'state';
import { deepFreeze, pick } from 'utils/core-utils';
import { getFormValues } from 'utils/form-utils';
import { summrizeResiliency } from 'utils/bucket-utils';
import {
    closeModal,
    updateForm,
    updateBucketResiliencyPolicy,
    openRiskyBucketDataResiliencyWarningModal
} from 'action-creators';

const formName = 'dataResiliency';

const defaults = deepFreeze({
    replicas: 3,
    dataFrags: 4,
    parityFrags: 2
});

const rebuildEffortToDisplay = deepFreeze({
    LOW: 'Low',
    HIGH: 'High',
    VERY_HIGH: 'Very High'
});

const failureToleranceTooltip = deepFreeze({
    position: 'above',
    text: 'Failure tolerance is below 2, in case of 1 failure data may be lost'
});

const requiredHostsTooltip = deepFreeze({
    position: 'above',
    text: 'Current resources does not support this configured resiliency policy'
});
const rebuildEffortTooltip = deepFreeze({
    position: 'above',
    text: 'Parity fragments rebuild time might take a while, varies according to data placement policy resources and type'
});

function _getFormInitalValues(bucket) {
    const {
        kind: resiliencyType,
        replicas = defaults.replicas,
        dataFrags = defaults.dataFrags,
        parityFrags = defaults.parityFrags
    } = bucket.resiliency;

    const advancedMode =
        replicas !== defaults.replicas ||
        dataFrags !== defaults.dataFrags ||
        parityFrags !== defaults.parityFrags;

    return { resiliencyType, advancedMode, replicas, dataFrags, parityFrags };
}

function _getFailureToleranceInfo(failureTolerance) {
    const warn = failureTolerance < 2;
    return {
        text: failureTolerance,
        css:  warn ? 'warning' : '',
        tooltip: warn ? failureToleranceTooltip : undefined
    };
}

function _getRequiredHostsInfo(requiredHosts, hostCountMetric) {
    const warn = requiredHosts > hostCountMetric;
    return {
        text: requiredHosts,
        css:  warn ? 'warning' : '',
        tooltip: warn ? requiredHostsTooltip : undefined
    };
}

function _getErasureCodingRebuildEffortInfo(rebuildEffort) {
    const warn = rebuildEffort === 'VERY_HIGH';
    return {
        text: rebuildEffortToDisplay[rebuildEffort],
        css: warn ? 'error' : '',
        tooltip: warn ? rebuildEffortTooltip : undefined
    };
}

class EditBucketDataResiliencyModalViewModel extends Observer {
    advancedMode = ko.observable(false);
    form = null;
    toggleModeBtnText = ko.observable();
    isReplicationDisabled = ko.observable();
    isErasureCodingDisabled = ko.observable();
    repCopies = ko.observable();
    repStorageOverhead = ko.observable();
    repFailureTolerance = ko.observable();
    repRequiredHosts = ko.observable();
    repRebuildEffort = ko.observable();
    repIsPolicyRisky = false;
    ecDisribution = ko.observable();
    ecStorageOverhead = ko.observable();
    ecFailureTolerance = ko.observable();
    ecRequiredHosts = ko.observable();
    ecRebuildEffort = ko.observable();
    ecIsPolicyRisky = false;

    constructor({ bucketName }) {
        super();

        this.observe(
            state$.getMany(
                ['forms', formName],
                ['buckets', bucketName],
            ),
            this.onState
        );
    }

    onState([form, bucket]) {
        if (!bucket) return;

        const hostCountMetric = bucket.resiliencyHostCountMetric;
        const values = form ? getFormValues(form) : _getFormInitalValues(bucket);
        this.bucketName = bucket.name;
        this.tierName = bucket.tierName;
        this.toggleModeBtnText(values.advancedMode ? 'Basic Settings' : 'Advanced Settings');
        this.isReplicationDisabled(values.resiliencyType !== 'REPLICATION');
        this.isErasureCodingDisabled(values.resiliencyType !== 'ERASURE_CODING');


        {
            const summary = summrizeResiliency({
                kind: 'REPLICATION',
                replicas: values.replicas
            });
            this.repCopies(summary.replicas);
            this.repStorageOverhead(numeral(summary.storageOverhead).format('%'));
            this.repFailureTolerance(_getFailureToleranceInfo(summary.failureTolerance));
            this.repRequiredHosts(_getRequiredHostsInfo(summary.requiredHosts, hostCountMetric));
            this.repRebuildEffort(rebuildEffortToDisplay[summary.rebuildEffort]);
            this.repIsPolicyRisky = summary.failureTolerance < 2;
        }

        {
            const summary = summrizeResiliency({
                kind: 'ERASURE_CODING',
                dataFrags: values.dataFrags,
                parityFrags: values.parityFrags
            });
            this.ecDisribution(`${summary.dataFrags} + ${summary.parityFrags}`);
            this.ecStorageOverhead(numeral(summary.storageOverhead).format('%'));
            this.ecFailureTolerance(_getFailureToleranceInfo(summary.failureTolerance));
            this.ecRequiredHosts(_getRequiredHostsInfo(summary.requiredHosts, hostCountMetric));
            this.ecRebuildEffort(_getErasureCodingRebuildEffortInfo(summary.rebuildEffort));
            this.ecIsPolicyRisky = summary.failureTolerance < 2;
        }

        if (!this.form) {
            this.form = new FormViewModel({
                name: formName,
                fields: {
                    advancedMode: values.advancedMode,
                    resiliencyType: values.resiliencyType,
                    replicas: values.replicas,
                    dataFrags: values.dataFrags,
                    parityFrags: values.parityFrags
                },
                onValidate: this.onValidate.bind(this),
                onSubmit: this.onSubmit.bind(this)
            });
        }
    }

    onToggleMode() {
        const values = {
            advancedMode: !this.form.advancedMode(),
            ...defaults
        };

        action$.onNext(updateForm(formName, values, false));
    }

    onCancel() {
        action$.onNext(closeModal());
    }

    onValidate(values) {
        const errors = {};
        const { resiliencyType, replicas, dataFrags, parityFrags } = values;

        if (resiliencyType === 'REPLICATION') {
            if (Number.isNaN(replicas) || replicas < 1) {
                errors.replicas = 'Please enter a number bigger then 0';
            }
        }

        if (values.resiliencyType === 'ERASURE_CODING') {
            if (Number.isNaN(dataFrags) || dataFrags < 1) {
                errors.dataFrags = 'Please enter a number bigger then 0';
            }

            if (Number.isNaN(parityFrags) || parityFrags < 1) {
                errors.parityFrags = 'Please enter a number bigger then 0';
            }

            if (dataFrags + parityFrags > 256) {
                errors.dataFrags = 'Data + parity must be below 256';
            }
        }

        return errors;
    }

    onSubmit(values) {
        const { resiliencyType } = values;
        const policy = resiliencyType == 'REPLICATION' ?
            pick(values, ['resiliencyType', 'replicas']) :
            pick(values, ['resiliencyType', 'dataFrags', 'parityFrags']);

        const isPolicyRisky = resiliencyType === 'REPLICATION' ?
            this.repIsPolicyRisky :
            this.ecIsPolicyRisky;

        if (isPolicyRisky) {
            action$.onNext(
                openRiskyBucketDataResiliencyWarningModal(this.bucketName, this.tierName, policy)
            );
        } else {
            action$.onNext(updateBucketResiliencyPolicy(this.bucketName, this.tierName, policy));
            action$.onNext(closeModal());
        }
    }

    dispose() {
        this.form && this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: EditBucketDataResiliencyModalViewModel,
    template: template
};
