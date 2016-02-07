import template from './about-form.html';
import ko from 'knockout';
import { systemInfo } from 'model';
import { upgradeSystem } from 'actions';


class AboutFormViewModel {
<<<<<<< HEAD
    constructor() {
        this.version = ko.pureComputed(
            () => systemInfo() && systemInfo().version 
        );
    }

    upgrade() {
        
    }
=======
	constructor({ onClose }) {
		this.version = ko.pureComputed(
			() => systemInfo() && systemInfo().version 
		);

		this.isUpgradingModalVisible = ko.observable(false);
	}

	upgrade(upgradePackage) {
		this.isUpgradingModalVisible(true);
		upgradeSystem(upgradePackage);
	}
>>>>>>> 5899a610afcb3d598d4507eb1f86f1bfdcc9a9cb
}

export default {
    viewModel: AboutFormViewModel,
    template: template
}