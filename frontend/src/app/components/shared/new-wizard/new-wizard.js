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
        this.onNext = onNext || noop;
        this.onPrev = onPrev || noop;
        this.onCancel = onCancel || noop;
        this.onComplete = onComplete || noop;
        this.shake = ko.observable();

        this.isFirstStep = ko.pureComputed(
            () => this.step() === 0
        );

        this.isLastStep = ko.pureComputed(
            () => this.step() === ko.unwrap(steps).length - 1
        );
    }

    onNextInternal() {
        if (this.isLastStep()) {
            return;
        }

        this.shake(this.onNext(this.step() + 1) === false);
    }

    onPrevInternal() {
        if (this.isFirstStep()) {
            return;
        }

        this.onPrev(this.step() - 1);
    }

    onCompleteInternal() {
        this.shake(this.onComplete() === false);
    }
}

export default {
    viewModel: NewWizardViewModel,
    template: template
};
