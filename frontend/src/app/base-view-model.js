// Used to dispose an handle that contain a dispose method.
function dispose(handle) {
    handle.dispose();
}

export default class BaseViewModel {
    constructor() {
        // Define a non enumrable read only property to hold the dispose list.
        Object.defineProperty(this, 'disposeList', { value: [] });
    }

    autoDispose(handle, disposer = dispose) {
        this.disposeList.push(
            () => disposer(handle)
        );
    }

    dispose() {
        this.disposeList.forEach(
            disposer => disposer()
        );
    }
}
