import template from './editor.html';

class EditorViewModel {
    constructor({ 
        label = '', 
        visible = true, 
        disable = false, 
        insertValMessages = true 
    }) {
        this.label = label;
        this.visible = visible;
        this.disable = disable;
        this.insertValMessages = insertValMessages;
    }
}

export default {
    viewModel: EditorViewModel,
    template: template
} 