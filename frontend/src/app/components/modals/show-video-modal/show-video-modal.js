/* Copyright (C) 2017 NooBaa */

import template from './show-video-modal.html';

class SelectVideoModalViewModel {
    constructor({ onClose, url }) {
        this.close = onClose;
        this.videoUrl = url;
    }

    onClose() {
        this.close();
    }
}

export default {
    viewModel: SelectVideoModalViewModel,
    template: template
};
