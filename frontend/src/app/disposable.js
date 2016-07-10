// Used to dispose an handle that contain a dispose method.
function dispose(handle) {
    handle.dispose();
}

export default class Disposable {
    constructor() {
        // Define a non enumrable read only property to hold the dispose list.
        Object.defineProperty(this, 'disposeList', { value: [] });
    }

    disposeWithMe(subject, disposer = dispose) {
        this.disposeList.push(
            () => disposer(subject)
        );
    }

    dispose() {
        this.disposeList.forEach(
            disposer => disposer()
        );
    }
}
