/* Copyright (C) 2016 NooBaa */

import template from './new-wizard.html';
import { noop } from 'utils/core-utils';
import ko from 'knockout';


class NewWizardViewModel {
    constructor({
        steps = [],
        step = ko.observable(0),
        actionLabel = 'Done',
        disabled = false,
        shakeOnFailedStep = true,
        onBeforeStep = () => true,
        onCancel = noop,
        onComplete = noop
    }) {
        this.steps = steps;
        this.step = step;
        this.disabled = disabled;
        this.onBeforeStep = onBeforeStep;
        this.onCancel = onCancel;
        this.onComplete = onComplete;
        this.shakeOnFailedStep = shakeOnFailedStep;
        this.shake = ko.observable(false);

        this.isFirstStep = ko.pureComputed(
            () => this.step() === 0
        );

        this.isLastStep = ko.pureComputed(
            () => this.step() === ko.unwrap(steps).length - 1
        );

        this.prevLabel = ko.pureComputed(
            () => this.isFirstStep() ? 'Cancel' : 'Previous'
        );

        this.nextLabel = ko.pureComputed(
            () => this.isLastStep() ? ko.unwrap(actionLabel) : 'Next'
        );
    }

    onStepForward() {
        this.shake(false);

        const step = this.step();
        if (ko.unwrap(this.disabled)|| !this.onBeforeStep(step)) {
            this.shake(ko.unwrap(this.shakeOnFailedStep));
            return;
        }

        this.isLastStep() ? this.onComplete() : this.step(step + 1);
    }

    onStepBackword() {
        if (ko.unwrap(this.disabled)) {
            return;
        }

        this.isFirstStep() ? this.onCancel() : this.step(this.step() - 1);
    }
}

export default {
    viewModel: NewWizardViewModel,
    template: template
};
