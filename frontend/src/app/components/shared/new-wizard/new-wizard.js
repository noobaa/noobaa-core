/* Copyright (C) 2016 NooBaa */

import template from './new-wizard.html';
import { ensureArray, noop } from 'utils/core-utils';
import ko from 'knockout';


class NewWizardViewModel {
    constructor(params, templates) {
        const {
            steps = [],
            step = ko.observable(0),
            actionLabel = 'Done',
            disabled = false,
            shakeOnFailedStep = true,
            onBeforeStep = () => true,
            onCancel = noop,
            onComplete = noop
        } = params;

        this.steps = steps;
        this.step = step;
        this.disabled = disabled;
        this.onBeforeStep = onBeforeStep;
        this.onCancel = onCancel;
        this.onComplete = onComplete;
        this.shakeOnFailedStep = shakeOnFailedStep;
        this.shake = ko.observable(false);

        this.stepTemplate = ko.pureComputed(() => {
            // Returning an array of one item to be used in with knockout foreach
            // binding and solve the problem of concurent rerandering that occur
            // when using knockout with binding.
            return ensureArray(templates[ko.unwrap(step)]);
        });

        this.isFirstStep = ko.pureComputed(() =>
            this.step() === 0
        );

        this.isLastStep = ko.pureComputed(() =>
            this.step() === ko.unwrap(steps).length - 1
        );

        this.prevLabel = ko.pureComputed(() =>
            this.isFirstStep() ? 'Cancel' : 'Previous'
        );

        this.nextLabel = ko.pureComputed(() =>
            this.isLastStep() ? ko.unwrap(actionLabel) : 'Next'
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

function _createViewModel(params, info) {
    const templates = info.templateNodes
        .filter(({ nodeType }) => nodeType === Node.ELEMENT_NODE);

    return new NewWizardViewModel(params, templates);
}


export default {
    viewModel: { createViewModel: _createViewModel },
    template: template
};
