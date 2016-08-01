import template from './wizard.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { isObject, noop } from 'utils';

class WizardViewModel extends Disposable {
    constructor({
        heading = '[wizard-heading]',
        steps = [],
        skip = 0,
        actionLabel = 'Done',
        validateStep = () => true,
        onCancel = noop,
        onComplete = noop,
        onClose = noop
    }) {
        super();

        this.heading = heading;
        this.actionLabel = actionLabel;
        this.step = ko.observable(skip);
        this.validateStep = validateStep;
        this.onCancel = onCancel;
        this.onComplete = onComplete;
        this.onClose = onClose;

        this.stepsNames = steps.map(
            step => isObject(step) ? step.name : step
        );

        this.stepClass = ko.pureComputed(
            () => {
                let step = steps[this.step()];
                return isObject(step) ? step.css : '';
            }
        );

        this.isLastStep = ko.pureComputed(
            () => this.step() == steps.length -1
        );

        this.isCancelVisible = ko.pureComputed(
            () => this.step() === 0
        );

        this.isPrevVisible = ko.pureComputed(
            () => this.step() > 0
        );

        this.isNextVisible = ko.pureComputed(
            () => this.step() < steps.length - 1
        );

        this.isDoneVisible = this.isLastStep;
    }

    isInStep(stepNum) {
        return this.step() === stepNum;
    }

    cancel() {
        this.onCancel();
        this.onClose();
    }

    prev() {
        if (this.step() > 0) {
            this.step(this.step() - 1);
        }
    }

    next() {
        if (!this.isLastStep() && this.validateStep(this.step() + 1)) {

            this.step(this.step() + 1);
        }
    }

    done() {
        if (this.validateStep(this.step() + 1)) {
            this.onComplete();
            this.onClose();
        }
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
