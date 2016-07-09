import template from './diagnostics-form.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { downloadSystemDiagnosticPack, setSystemDebugLevel } from 'actions';
import { isUndefined } from 'utils';

class DiagnosticsFormViewModel extends BaseViewModel {
    constructor() {
        super();

        this.debugLevel = ko.pureComputed(
            () => systemInfo() && systemInfo().debug_level
        );

        this.debugLevelText = ko.pureComputed(
            () => {
                if (isUndefined(this.debugLevel())) {
                    return 'N/A';
                }

                return this.debugLevel() > 0 ? 'High' : 'Low';
            }
        );

        this.toogleDebugLevelButtonText = ko.pureComputed(
            () => `${this.debugLevel() > 0 ? 'Lower' : 'Raise' } Debug Level`
        );
    }

    toogleDebugLevel() {
        setSystemDebugLevel(this.debugLevel() > 0 ? 0 : 5);
    }

    downloadDiagnosticPack() {
        downloadSystemDiagnosticPack();
    }
}

export default {
    viewModel: DiagnosticsFormViewModel,
    template: template
};
