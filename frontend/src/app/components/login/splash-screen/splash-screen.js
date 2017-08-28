/* Copyright (C) 2016 NooBaa */

import template from './splash-screen.html';
import Observer from 'observer';

class SplashScreenViewModel extends Observer {
    constructor() {
        super();
    }
}

export default {
    viewModel: SplashScreenViewModel,
    template: template
};
