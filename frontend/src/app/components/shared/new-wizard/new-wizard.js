import template from './new-wizard.html';
import BaseViewModel from 'components/base-view-model';
import { noop } from 'utils/core-utils';
import ko from 'knockout';

class NewWizardViewModel extends BaseViewModel {
    constructor({
        steps = [],
        step = ko.observable(),
        actionLabel = 'Done',
        onNext,
        onPrev,
        onCancel,
        onComplete
    }) {
        super();

        this.steps = steps;
        this.step = step;
        this.actionLabel = actionLabel;
        this.onNext = onNext || this.onNext;
        this.onPrev = onPrev || this.onPrev;
        this.onCancel = onCancel || noop;
        this.onComplete = onComplete || noop;

        this.isFirstStep = ko.pureComputed(
            () => this.step() === 0
        );

        this.isLastStep = ko.pureComputed(
            () => this.step() === ko.unwrap(steps).length - 1
        );
    }

    onNext() {
        if (this.isLastStep()) {
            return;
        }

        this.step(this.step() + 1);
    }

    onPrev() {
        if (this.isFirstStep()) {
            return;
        }

        this.step(this.step() - 1);
    }
}

export default {
    viewModel: NewWizardViewModel,
    template: template
};
