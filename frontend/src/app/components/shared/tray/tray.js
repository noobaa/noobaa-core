import template from './tray.html';
import ko from 'knockout';
import { uiState } from 'model';
import { closeTray } from 'actions';

class TrayViewModel {
	constructor() {
		this.tray = ko.pureComputed(
			() => uiState().tray
		);

		// Hold the content of the tray state until transition (slide) is over.
		this.memory = ko.observable();

		// Serve the content of the tray form ui state or memory.
		this.content = ko.pureComputed(
			() => this.tray() || this.memory()
		);

		// Adding rate limit to create an async behaviour in order to apply 
		// css transitions. 
		this.stateClass = ko.pureComputed(
			() => !!this.tray() ? 'opened' : 'closed'
		)
		.extend({ rateLimit: 1 })

	}

	updateMemory() {
		this.memory(this.tray())
	}

	close() {
		closeTray();
	}
}

export default {
	viewModel: TrayViewModel,
	template: template
}