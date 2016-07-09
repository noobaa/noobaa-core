import template from './stepper.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';

class StepperViewModel extends BaseViewModel {
    constructor({ steps, current = 0 }) {
        super();

        this.current = current;

        this.steps = steps.map(
            (name = '[not set]', i) => ({
                name: name,
                selected: ko.pureComputed(
                    () => i === ko.unwrap(this.current)
                )
            })
        );
    }
}

export default {
    viewModel: StepperViewModel,
    template: template
};
