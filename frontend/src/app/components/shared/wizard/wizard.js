import template from './wizard.html';
import ko from 'knockout';
import { noop } from 'utils';

class WizardViewModel {
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
        this.heading = heading;
        this.steps = steps;
        this.actionLabel = actionLabel;
        this.step = ko.observable(skip);
        this.validateStep = validateStep;
        this.onCancel = onCancel;
        this.onComplete = onComplete;
        this.onClose = onClose;

        this.stepsTransform = ko.pureComputed(
            () => `translate(${this.step() * -100}%)`
        );

        this.isCancelVisible = ko.pureComputed(
            () => this.step() === 0
        );

        this.isPrevVisible = ko.pureComputed(
            () => this.step() > 0
        );        

        this.isNextVisible = ko.pureComputed(
            () => this.step() < this.steps.length - 1
        );

        this.isDoneVisible = ko.pureComputed(
            () => this.step() === this.steps.length - 1
        );
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
        if (this.step() < this.steps.length - 1 && 
            this.validateStep(this.step() + 1)) {
            
            this.step(this.step() + 1)
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
    
    params.steps.length = elms.length;

    return new WizardViewModel(params);
}

export default {
    viewModel: { createViewModel: modelFactory },
    template: template
}