import template from './diagnostics-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';
import { downloadSystemDiagnosticPack, setSystemDebugLevel } from 'actions';
import { isUndefined } from 'utils';
import { support } from 'config';

class DiagnosticsFormViewModel extends Disposable {
    constructor() {
        super();

        this.contactSupport = [
            {
                label: 'By email',
                value: `<a class="link" href="mailto:${support.email}">${support.email}</a>`
            },
            {
                label: 'Support center',
                value: `<a class="link" href="${support.helpDesk}" target="_blank">${support.helpDesk}</a>`
            }
        ];


        this.secret = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster.master_secret
        );

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
        downloadSystemDiagnosticPack(this.secret());
    }
}

export default {
    viewModel: DiagnosticsFormViewModel,
    template: template
};
