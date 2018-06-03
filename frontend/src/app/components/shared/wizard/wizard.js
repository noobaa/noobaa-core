/* Copyright (C) 2016 NooBaa */

import template from './wizard.html';
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
            onComplete = noop,
            renderControls = true
        } = params;

        this.steps = steps;
        this.step = step;
        this.actionLabel = actionLabel;
        this.disabled = disabled;
        this.shakeOnFailedStep = shakeOnFailedStep;
        this.shake = ko.observable(false);
        this.beforeStepHandler = onBeforeStep;
        this.cancelHandler = onCancel;
        this.completeHandler = onComplete;
        this.renderControls = renderControls;

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

        const methodsTobind = ['onCancel', 'onStepForward', 'onStepBackword', 'onSubmit'];
        for (const method of methodsTobind) {
            this[method] = this[method].bind(this);
        }
    }

    // ----------------------------------------------------------------------------
    // Making all of the following handlers async to gurentee that the handlers`
    // code will be schedule to run at the end of the event queue.
    // ----------------------------------------------------------------------------

    async onCancel() {
        this.cancelHandler();
    }

    async onStepForward() {
        this.shake(false);

        const step = this.step();
        if (!this.beforeStepHandler(step)) {
            this.shake(ko.unwrap(this.shakeOnFailedStep));
            return;
        }

        this.step(step + 1);
    }

    async onStepBackword() {
        this.step(this.step() - 1);
    }

    async onSubmit() {
        if (!this.isLastStep()) {
            return;
        }

        this.shake(false);

        if (!this.beforeStepHandler(this.step())) {
            this.shake(ko.unwrap(this.shakeOnFailedStep));
            return;
        }

        this.completeHandler();
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
