import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';

export default class UploadRowViewModel extends Disposable {
    constructor(upload) {
        super();

        this.fileName = ko.pureComputed(
            () => upload() ? upload().name : ''
        );

        this.progress = ko.pureComputed(
            () => {
                if (!upload()) {
                    return {};
                }

                let { completed, error, size, progress } = upload();
                let text = completed ?
                    (error ? 'FAILED' : 'UPLOADED') :
                    numeral(progress/size).format('0%');

                let tooltip = error || '';

                let css = '';
                if (error) {
                    css = 'error';
                } else if (completed) {
                    css = 'success';
                }

                return { text, css, tooltip };
            }
        );
    }
}
