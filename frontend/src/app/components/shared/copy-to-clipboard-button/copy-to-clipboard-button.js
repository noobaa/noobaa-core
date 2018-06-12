/* Copyright (C) 2016 NooBaa */

import template from './copy-to-clipboard-button.html';
import ko from 'knockout';
import { copyTextToClipboard } from 'utils/browser-utils';
import { sleep } from 'utils/promise-utils';

const copyMessage = 'Copy to Clipboard';
const copiedMessage = 'Copied';

class CopyToClipboardButtonViewModel{
    value = '';
    disabled = false;
    tooltip = ko.observable();
    handle = -1;

    constructor({ value, disabled = false }) {
        this.value = value;
        this.disabled = disabled;
        this.tooltip = ko.observable(copyMessage);
    }

    onClick() {
        copyTextToClipboard(ko.unwrap(this.value));
        this.tooltip(copiedMessage);
    }

    async onEnter() {
        if (this.tooltip() == copiedMessage) {
            this.tooltip(null);
            await sleep(400);
            this.tooltip(copyMessage);
        }
    }
}

export default {
    viewModel: CopyToClipboardButtonViewModel,
    template: template
};
