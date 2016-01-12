import template from './stepper.html';
import ko from 'knockout';

class StepperViewModel {
	constructor({ steps, current = 0 }) {
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
}