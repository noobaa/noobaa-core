/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-data-resiliency-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import numeral from 'numeral';
import { deepFreeze, pick, flatMap } from 'utils/core-utils';
import { getFormValues } from 'utils/form-utils';
import { editBucketDataResiliency as learnMoreHref } from 'knowledge-base-articles';
import {
    countStorageNodesByMirrorSet,
    summrizeResiliency,
    getResiliencyRequirementsWarning
} from 'utils/bucket-utils';
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

class EditBucketDataResiliencyModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    bucketName = '';
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
    fields = ko.observable();

    selectState(state, params) {
        const { buckets, hostPools, forms } = state;
        return [
            buckets && buckets[params.bucketName],
            hostPools,
            forms[this.formName]
        ];
    }

    mapStateToProps(bucket, hostPools, form) {
        if (!bucket || !hostPools) {
            return;
        }

        const values = form ? getFormValues(form) : _getFormInitalValues(bucket);
        const nodeCountInMirrorSets = flatMap(
            bucket.placement.tiers,
            tier => countStorageNodesByMirrorSet(tier, hostPools)
        );

        const minNodeCountInMirrorSets = Math.min(...nodeCountInMirrorSets);
        const repSummary = summrizeResiliency({
            kind: 'REPLICATION',
            replicas: values.replicas
        });
        const repRequiredDrives = _getRequiredDrivesInfo(
            'REPLICATION',
            repSummary.requiredDrives,
            minNodeCountInMirrorSets,
        );
        const ecSummary = summrizeResiliency({
            kind: 'ERASURE_CODING',
            dataFrags: values.dataFrags,
            parityFrags: values.parityFrags
        });
        const ecRequiredDrives = _getRequiredDrivesInfo(
            'ERASURE_CODING',
            ecSummary.requiredDrives,
            minNodeCountInMirrorSets
        );

        ko.assignToProps(this, {
            bucketName: bucket.name,
            advancedMode: values.advancedMode,
            toggleModeBtnText: values.advancedMode ? 'Basic Settings' : 'Advanced Settings',
            isReplicationDisabled: !values.advancedMode || values.resiliencyType !== 'REPLICATION',
            isErasureCodingDisabled: !values.advancedMode || values.resiliencyType !== 'ERASURE_CODING',
            repCopies: repSummary.replicas,
            repStorageOverhead: numeral(repSummary.storageOverhead).format('%'),
            repFailureTolerance: _getFailureToleranceInfo(repSummary.failureTolerance),
            repRequiredDrives: repRequiredDrives,
            repRebuildEffort: rebuildEffortToDisplay[repSummary.rebuildEffort],
            repIsPolicyRisky: repSummary.failureTolerance < 2,
            ecDisribution: `${ecSummary.dataFrags} + ${ecSummary.parityFrags}`,
            ecStorageOverhead: numeral(ecSummary.storageOverhead).format('%'),
            ecFailureTolerance: _getFailureToleranceInfo(ecSummary.failureTolerance),
            ecRequiredDrives: ecRequiredDrives,
            ecRebuildEffort: _getErasureCodingRebuildEffortInfo(ecSummary.rebuildEffort),
            ecIsPolicyRisky: ecSummary.failureTolerance < 2,
            fields: !form ? values : undefined
        });
    }

    onToggleMode() {
        const values = {
            advancedMode: !this.advancedMode,
            ...defaults
        };

        this.dispatch(updateForm(this.formName, values, false));
    }

    onCancel() {
        this.dispatch(closeModal());
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

        const action = updateBucketResiliencyPolicy(
            this.bucketName,
            policy
        );

        const isPolicyRisky = resiliencyType === 'REPLICATION' ?
            this.repIsPolicyRisky :
            this.ecIsPolicyRisky;

        if (isPolicyRisky) {
            this.dispatch(openRiskyBucketDataResiliencyWarningModal(action));

        } else {
            this.dispatch(
                closeModal(),
                action
            );
        }
    }
}

export default {
    viewModel: EditBucketDataResiliencyModalViewModel,
    template: template
};

