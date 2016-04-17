import template from './diagnostics-form.html';
import { downloadSystemDiagnosticPack } from 'actions';

class DiagnosticsFormViewModel {
    downloadDiagnosticPack() {
        downloadSystemDiagnosticPack();
    }    
}

export default {
    viewModel: DiagnosticsFormViewModel,
    template: template
}