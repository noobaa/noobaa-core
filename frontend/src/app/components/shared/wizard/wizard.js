import template from './wizard.html';
import ko from 'knockout';
import { noop, equalNoCase } from 'utils';

class WizardViewModel {
	constructor({
		heading = '[wizard-heading]', 
		steps = [],
		skip = 0
	}) {
		this.heading = heading;
		this.steps = steps;
		this.doneLabel = 'Done';
		this.oncomplete = noop;
		this.step = ko.observable(skip);		

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
		//this.oncomplete();
	}

	prev() {
		this.step() > 0 && this.step(this.step() - 1);
	}

	next() {
		this.step() < this.steps.length - 1 && this.step(this.step() + 1);
	}

	done() {
		this.oncomplete();
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