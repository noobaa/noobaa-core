import template from './commands-bar.html'; 
import ko from 'knockout';
import { uiState } from 'model';
import { refresh, signOut, openAuditLog, closeTray } from 'actions';

class CommandBarViewModel {
	constructor() {
		this.isTrayOpen = ko.pureComputed(
			() => !!uiState().tray
		)
	}

	refresh() {
		refresh();
	}

	showAuditLog() {
		this.isTrayOpen() ? closeTray() : openAuditLog();
	}

	showManagement() {
	}	

	signOut() {
		signOut();
	}	
}

export default { 
	viewModel: CommandBarViewModel,
	template: template
}
