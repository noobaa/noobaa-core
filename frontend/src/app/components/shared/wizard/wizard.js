/* Copyright (C) 2016 NooBaa */

import template from './wizard.html';
import ko from 'knockout';
import { isObject, noop } from 'utils/core-utils';

class WizardViewModel {
    constructor({
        heading = '[wizard-heading]',
        size = 'small',
        steps = [],
        skip = 0,
        actionLabel = 'Done',
        validateStep = () => true,
        onCancel = noop,
        onComplete = noop,
        onClose = noop
    }) {
        this.heading = heading;
        this.step = ko.observable(skip);
        this.isStepValid = ko.observable(false);
        this.validateStep = validateStep;
        this.onCancel = onCancel;
        this.onComplete = onComplete;
        this.onClose = onClose;

        this.stepsLabels = steps.map(
            step => isObject(step) ? step.label : step
        );

        this.stepClass = ko.pureComputed(
            () => {
                let step = steps[this.step()];
                return `modal-${(isObject(step) && step.size) || size}` ;
            }
        );

        this.isFirstStep = ko.pureComputed(
            () => this.step() === 0
        );

        this.isLastStep = ko.pureComputed(
            () => this.step() === steps.length - 1
        );

        this.prevText = ko.pureComputed(
            () => this.isFirstStep() ? 'Cancel' : 'Previous'
        );

        this.nextLabel = ko.pureComputed(
            () => this.isLastStep() ? ko.unwrap(actionLabel) : 'Next'
        );
    }

    isInStep(stepNum) {
        return this.step() === stepNum;
    }

    prev() {
        if (this.isFirstStep()) {
            this.cancel();

        } else {
            this.step(this.step() - 1);
        }
    }

    next() {
        this.isStepValid(this.validateStep(this.step() + 1));
        if (!this.isStepValid()) {
            return;
        }

        if (this.isLastStep()) {
            this.complete();

        } else {
            this.step(this.step() + 1);
        }
    }

    cancel() {
        this.onCancel();
        this.onClose();
    }

    complete() {
        this.onComplete();
        this.onClose();
    }
}

function modelFactory(params, ci) {
    let elms = ci.templateNodes.filter(
        node => node.nodeType === 1
    );

    // In order for the filtering to take effect we need to change the
    // original array and not just replace it.
    ci.templateNodes.length = 0;
    ci.templateNodes.push(...elms);

    params.steps = params.steps.slice(0, elms.length);

    return new WizardViewModel(params);
}

export default {
    viewModel: { createViewModel: modelFactory },
    template: template
};
