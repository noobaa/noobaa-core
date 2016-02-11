import template from './editor.html';

class EditorViewModel {
    constructor({ label = '', visible = true, insertValMessages = true }) {
        this.label = label;
        this.visible = visible;
        this.insertValMessages = insertValMessages;
    }
}

export default {
    viewModel: EditorViewModel,
    template: template
} 