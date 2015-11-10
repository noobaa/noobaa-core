import template from './commands-bar.html'; 
import { refresh } from 'actions';

class CommandBarViewModel {
	constructor() {
		this.refresh = refresh;
	}
}

export default { 
	viewModel: CommandBarViewModel,
	template: template
}
