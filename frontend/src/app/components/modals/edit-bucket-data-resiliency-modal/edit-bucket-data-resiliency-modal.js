/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-data-resiliency-modal.html';
import Observer from 'observer';
import ko from 'knockout';
import numeral from 'numeral';
import { state$, action$ } from 'state';
import { deepFreeze, pick } from 'utils/core-utils';
import { getFormValues } from 'utils/form-utils';
import { countStorageNodesByMirrorSet, summrizeResiliency, getResiliencyRequirementsWarning } from 'utils/bucket-utils';
import { getMany } from 'rx-extensions';
import { editBucketDataResiliency as learnMoreHref } from 'knowledge-base-articles';
import {
    closeModal,
    updateForm,
    updateBucketResiliencyPolicy,
    openRiskyBucketDataResiliencyWarningModal
} from 'action-creators';

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
    text: 'It is not recommended to use a resiliency policy which results in less than a fault tolerance value of 2'
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

function _getRequiredDrivesInfo(resiliencyType, requiredDrives, driveCountMetric) {
    const warn = requiredDrives > driveCountMetric;
    const tooltip = {
        position: 'above',
        text: getResiliencyRequirementsWarning(resiliencyType, driveCountMetric)
    };

    return {
        text: requiredDrives,
        css:  warn ? 'warning' : '',
        tooltip: warn ? tooltip : undefined
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
    formName = this.constructor.name;
    fields = ko.observable();
    advancedMode = false;
    toggleModeBtnText = ko.observable();
    isReplicationDisabled = ko.observable();
    isErasureCodingDisabled = ko.observable();
    repCopies = ko.observable();
    repStorageOverhead = ko.observable();
    repFailureTolerance = ko.observable();
    repRequiredDrives = ko.observable();
    repRebuildEffort = ko.observable();
    repIsPolicyRisky = false;
    ecDisribution = ko.observable();
    ecStorageOverhead = ko.observable();
    ecFailureTolerance = ko.observable();
    ecRequiredDrives = ko.observable();
    ecRebuildEffort = ko.observable();
    ecIsPolicyRisky = false;
    learnMoreHref = learnMoreHref

    constructor({ bucketName }) {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    ['buckets', ko.unwrap(bucketName)],
                    'hostPools',
                    ['forms', this.formName],
                )
            ),
            this.onState
        );
    }

    onState([bucket, hostPools, form]) {
        if (!bucket) return;

        const values = form ? getFormValues(form) : _getFormInitalValues(bucket);
        const minNodeCountInMirrorSets = Math.min(
            ...countStorageNodesByMirrorSet(bucket.placement2, hostPools)
        );

        this.bucketName = bucket.name;
        this.tierName = bucket.tierName;
        this.advancedMode = values.advancedMode;
        this.toggleModeBtnText(values.advancedMode ? 'Basic Settings' : 'Advanced Settings');
        this.isReplicationDisabled(!values.advancedMode || values.resiliencyType !== 'REPLICATION');
        this.isErasureCodingDisabled(!values.advancedMode || values.resiliencyType !== 'ERASURE_CODING');

        {
            const summary = summrizeResiliency({
                kind: 'REPLICATION',
                replicas: values.replicas
            });
            const requiredDrives = _getRequiredDrivesInfo(
                'REPLICATION',
                summary.requiredDrives,
                minNodeCountInMirrorSets,
            );

            this.repCopies(summary.replicas);
            this.repStorageOverhead(numeral(summary.storageOverhead).format('%'));
            this.repFailureTolerance(_getFailureToleranceInfo(summary.failureTolerance));
            this.repRequiredDrives(requiredDrives);
            this.repRebuildEffort(rebuildEffortToDisplay[summary.rebuildEffort]);
            this.repIsPolicyRisky = summary.failureTolerance < 2;
        }

        {
            const summary = summrizeResiliency({
                kind: 'ERASURE_CODING',
                dataFrags: values.dataFrags,
                parityFrags: values.parityFrags
            });
            const requiredDrives = _getRequiredDrivesInfo(
                'ERASURE_CODING',
                summary.requiredDrives,
                minNodeCountInMirrorSets
            );

            this.ecDisribution(`${summary.dataFrags} + ${summary.parityFrags}`);
            this.ecStorageOverhead(numeral(summary.storageOverhead).format('%'));
            this.ecFailureTolerance(_getFailureToleranceInfo(summary.failureTolerance));
            this.ecRequiredDrives(requiredDrives);
            this.ecRebuildEffort(_getErasureCodingRebuildEffortInfo(summary.rebuildEffort));
            this.ecIsPolicyRisky = summary.failureTolerance < 2;
        }

        if (!this.fields()) {
            this.fields({
                advancedMode: values.advancedMode,
                resiliencyType: values.resiliencyType,
                replicas: values.replicas,
                dataFrags: values.dataFrags,
                parityFrags: values.parityFrags
            });
        }
    }

    onToggleMode() {
        const values = {
            advancedMode: !this.advancedMode,
            ...defaults
        };

        action$.next(updateForm(this.formName, values, false));
    }

    onCancel() {
        action$.next(closeModal());
    }

    onValidate(values) {
        const errors = {};
        const { resiliencyType, replicas, dataFrags, parityFrags } = values;

        if (resiliencyType === 'REPLICATION') {
            if (Number.isNaN(replicas) || replicas < 1 || replicas > 32) {
                errors.replicas = 'Please enter a value between 1-32';
            }
        }

        if (values.resiliencyType === 'ERASURE_CODING') {
            if (Number.isNaN(dataFrags) || dataFrags < 1 || dataFrags > 32) {
                errors.dataFrags = 'Please enter a value between 1-32';
            }

            if (Number.isNaN(parityFrags) || parityFrags < 1 || parityFrags > 32) {
                errors.parityFrags = 'Please enter a value between 1-32';
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
            action$.next(
                openRiskyBucketDataResiliencyWarningModal(this.bucketName, this.tierName, policy)
            );
        } else {
            action$.next(updateBucketResiliencyPolicy(this.bucketName, this.tierName, policy));
            action$.next(closeModal());
        }
    }
}

export default {
    viewModel: EditBucketDataResiliencyModalViewModel,
    template: template
};
