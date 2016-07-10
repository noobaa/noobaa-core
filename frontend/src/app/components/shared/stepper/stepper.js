import template from './stepper.html';
import Disposable from 'disposable';
import ko from 'knockout';

class StepperViewModel extends Disposable {
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
