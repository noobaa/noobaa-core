import template from './token-field.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { splice } from 'utils/string-utils';

const enterKeyCode = 13;
const backspaceKeyCode = 8;
const tokenSeperator = '\n';

class TokenFieldViewModel extends BaseViewModel {
    constructor({
        tokens = ko.observableArray(),
        placeholder = 'Type to add tokens'
    }) {
        super();

        this.tokens = tokens;
        this.text = ko.observable('');
        this.cursor = ko.observable(this.tokens().length);
        this.selection = ko.observable(0);
        this.hasFocus = ko.observable(false);
        this.placeholder = ko.pureComputed(
            () => this.hasFocus() ? '' : placeholder
        );

        this.eventHandlers = {
            mousedown: this.onMouseDown,
            paste: this.onPaste,
            keypress: this.onKeyPress,
            keydown: this.onKeyDown
        };

        this.text.subscribe(
            text => text ?
                this.tokens.splice(this.cursor(), 1, text) :
                this.tokens.splice(this.cursor(), 1)
        );
    }

    onMouseDown() {
        this.hasFocus(true);
        return true;
    }

    onKeyPress(_, { which }) {
        if (which !== enterKeyCode || !this.text()) {
            return true;
        }

        this.cursor(this.cursor() + 1);
        this.text('');
    }

    onKeyDown(_, { which }) {
        if (which === backspaceKeyCode && !this.text()) {
            this.cursor(this.cursor() - 1);
            this.text(this.tokens()[this.cursor()]);
        } else {
            return true;
        }
    }

    onPaste(_, { clipboardData }) {
        const text = clipboardData.getData('text');
        if (!text) {
            return;
        }

        const { start, end } = this.selection();
        const list = splice(this.text(), start, end, text)
            .split(tokenSeperator);

        if (list.length > 1) {
            this.text('');
            this.tokens.splice(this.cursor(), 1, ...list);
            this.cursor(this.tokens().length);
        } else {
            return true;
        }
    }

    onRemoveToken(index) {
        this.tokens.splice(index, 1);
        this.cursor(this.cursor() - 1);
        this.hasFocus(true);
    }


}

export default {
    viewModel: TokenFieldViewModel,
    template: template
};
