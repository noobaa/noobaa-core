import template from './token-field.html';
import ko from 'knockout';
import { splice } from 'utils/string-utils';
import { echo } from 'utils/core-utils';

const enterKeyCode = 13;
const backspaceKeyCode = 8;
const tokenSeperator = '\n';

class TokenFieldViewModel {
    constructor({
        tokens = ko.observable([]),
        disabled = false,
        placeholder = 'Type to add tokens'
    }) {
        this.text = ko.observable();
        this.disabled = disabled;
        this.placeholder = ko.pureComputed(
            () => this.hasFocus() ? '' : placeholder
        );

        this.list = ko.observableArray(tokens() ? Array.from(tokens) : []);
        this.selection = ko.observable(0);
        this.hasFocus = ko.observable(false);
        this.hasFocus.subscribe(f => !f && this.onBlur());

        this.scroll = ko.observable().extend({
            notify: 'always'
        });

        this.eventHandlers = {
            mousedown: this.onMouseDown,
            paste: this.onPaste,
            keypress: this.onKeyPress,
            keydown: this.onKeyDown
        };

        this.tokens = tokens;
        this.tokensSub = this.tokens.subscribe(
            tokens => this.list(Array.from(tokens))
        );
    }

    onMouseDown() {
        this.hasFocus(true);
    }

    onKeyPress(_, { which }) {
        if (which !== enterKeyCode || !this.text()) {
            return true;
        }

        this.list.push(this.text());
        this.text('');
        this.scroll(1);
    }

    onKeyDown(_, { which }) {
        if (which === backspaceKeyCode && !this.text()) {
            this.text(this.list.pop());
        } else {
            return true;
        }
    }

    onBlur() {
        this.tokens(
            Array.from(this.list()
        );
    }

    onPaste(_, { clipboardData }) {
        const text = clipboardData.getData('text');
        if (!text) {
            return;
        }

        const { start, end } = this.selection();
        const list = splice(this.text(), start, end, text)
            .split(tokenSeperator)
            .filter(token => Boolean(token.trim()));

        if (list.length > 1) {
            this.text('');
            this.tokens.splice(this.cursor(), 1, ...list);
            this.scroll(1);
        } else {
            return true;
        }
    }

    onRemoveToken(index) {
        this.list.splice(index, 1);
        this.hasFocus(true);
    }

    dispose() {
        this.tokensSub.dispose();
    }
}

export default {
    viewModel: TokenFieldViewModel,
    template: template
};
